import fs from "node:fs";
import path from "node:path";

import {
  requestOptions,
  sleepUntilAborted,
  throwIfAborted,
} from "./abort-signal.js";
import { safeTaskDirName, prepareTaskWorktree, removeTaskWorktree } from "./task-worktree.js";
import { nowIso } from "./utils.js";
import {
  buildDryRunWorkerResult,
  collectChangedFiles,
  createFailedWorkerResult,
  assertSafeBranchName,
  materializeAssignmentPackage,
  maybeCommitAndPush,
  maybeCreatePullRequest,
  runWorkerAssignmentScript,
  shouldCreatePullRequest,
  writeWorkerResultFiles,
} from "./task-output.js";
import type { PullRequestInfo, ProcessTaskAssignmentInput, TaskPayload, WorkerProtocolEnvelope, WorkerResult } from "./types.js";

const SUBMIT_RESULT_MAX_RETRIES = 3;
const SUBMIT_RESULT_RETRY_DELAY_MS = 2_000;
export const DEFAULT_WORKER_EXECUTION_TIMEOUT_MS = 30 * 60_000;

export class WorkerResultDeliveryError extends Error {
  readonly code = "worker_result_delivery_failed";
}

export interface TaskExecutionResult {
  result: WorkerResult;
  worktreeDir: string;
  outputDir: string;
  changedFiles: string[];
  pullRequest: PullRequestInfo | null;
}

interface LiveWorkerTaskContext {
  taskId: string;
  worktreeDir: string;
  assignmentDir: string;
  outputDir: string;
}

export interface SubmitFailedWorkerResultInput {
  input: ProcessTaskAssignmentInput;
  taskId?: string;
  error: unknown;
  maxRetries?: number;
  retryDelayMs?: number;
  onSubmitted?: (event: { taskId: string }) => void | Promise<void>;
  onSubmitAttemptFailed?: (event: {
    taskId: string;
    attempt: number;
    maxRetries: number;
    error: string;
  }) => void | Promise<void>;
  onFallbackFailed?: (event: { taskId: string; error: string }) => void | Promise<void>;
}

export interface LiveWorkerTaskEvent {
  type: string;
  taskId?: string;
  payload?: unknown;
}

export function resolveWorkerExecutionTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const value = Number(env.WORKER_DAEMON_EXECUTION_TIMEOUT_MS);
  return Number.isSafeInteger(value) && value > 0
    ? value
    : DEFAULT_WORKER_EXECUTION_TIMEOUT_MS;
}

export interface ExecuteLiveWorkerTaskInput extends ProcessTaskAssignmentInput {
  createPullRequest?: boolean;
  removeWorktreeOnExit?: boolean;
  resetWorktreeOnReuse?: boolean;
  runtimeScriptPath?: string;
  runtimeScriptCwd?: string;
  executionTimeoutMs?: number;
  reportEvent?: (event: LiveWorkerTaskEvent) => Promise<void>;
  onCleanupError?: (error: unknown) => void;
}

export function buildWorkerProtocolEnvelope(payload: TaskPayload): WorkerProtocolEnvelope {
  return {
    attemptId: payload.attemptId,
    leaseToken: payload.leaseToken,
    protocolVersion: payload.protocolVersion,
    traceId: payload.traceId,
    idempotencyKey: payload.idempotencyKey,
  };
}

export async function executeLiveWorkerTask(input: ExecuteLiveWorkerTaskInput): Promise<TaskExecutionResult> {
  let context: LiveWorkerTaskContext | null = null;
  try {
    context = await prepareLiveWorkerTask(input);
    const result = await runLiveWorkerTask(input, context);
    const changedFiles = input.dryRunExecution ? [] : collectChangedFiles(context.worktreeDir);
    await reportLiveWorkerExecutionCompleted(input, context.taskId, changedFiles.length);
    const pullRequest = await finalizeLiveWorkerTask(input, context.worktreeDir, changedFiles);
    return {
      worktreeDir: context.worktreeDir,
      outputDir: context.outputDir,
      result,
      changedFiles,
      pullRequest,
    };
  } finally {
    await cleanupLiveWorkerTask(input, context);
  }
}

async function prepareLiveWorkerTask(input: ExecuteLiveWorkerTaskInput): Promise<LiveWorkerTaskContext> {
  const taskId = input.payload.task.id;
  assertSafeBranchName(input.repoDir, input.payload.assignment.branchName, input.payload.assignment.defaultBranch);
  const worktreeDir = prepareTaskWorktree(input.repoDir, input.payload.assignment, {
    allowReuse: true,
    resetOnReuse: input.resetWorktreeOnReuse ?? true,
  });
  const assignmentDir = materializeAssignmentPackage(worktreeDir, input.payload);
  const outputDir = path.join(assignmentDir, "execution");
  fs.mkdirSync(outputDir, { recursive: true });
  await input.reportEvent?.({
    type: "progress_reported",
    taskId,
    payload: { stage: "worktree_prepared", message: "worktree prepared, running worker assignment" },
  });
  return { taskId, worktreeDir, assignmentDir, outputDir };
}

function runLiveWorkerTask(input: ExecuteLiveWorkerTaskInput, context: LiveWorkerTaskContext): Promise<WorkerResult> | WorkerResult {
  if (input.dryRunExecution) {
    return buildDryRunWorkerResult(input.payload, context.outputDir, input.at ?? nowIso());
  }
  return runWorkerAssignmentScript({
    packageRoot: input.packageRoot,
    assignmentDir: context.assignmentDir,
    worktreeDir: context.worktreeDir,
    outputDir: context.outputDir,
    provider: input.payload.assignment.pool,
    runtimeScriptPath: input.runtimeScriptPath,
    runtimeScriptCwd: input.runtimeScriptCwd,
    timeoutMs: Number.isSafeInteger(input.executionTimeoutMs) && (input.executionTimeoutMs ?? 0) > 0
      ? input.executionTimeoutMs
      : resolveWorkerExecutionTimeoutMs(),
    signal: input.signal,
  });
}

async function reportLiveWorkerExecutionCompleted(
  input: ExecuteLiveWorkerTaskInput,
  taskId: string,
  changedFileCount: number,
): Promise<void> {
  await input.reportEvent?.({
    type: "progress_reported",
    taskId,
    payload: {
      stage: "execution_completed",
      message: `worker execution completed, ${changedFileCount} changed file(s)`,
    },
  });
}

async function finalizeLiveWorkerTask(
  input: ExecuteLiveWorkerTaskInput,
  worktreeDir: string,
  changedFiles: string[],
): Promise<PullRequestInfo | null> {
  if (input.dryRunExecution) {
    return null;
  }
  maybeCommitAndPush(worktreeDir, input.payload, changedFiles);
  return maybeCreatePullRequest(input.payload, changedFiles, {
    createPullRequest: input.createPullRequest ?? shouldCreatePullRequest(),
  });
}

async function cleanupLiveWorkerTask(
  input: ExecuteLiveWorkerTaskInput,
  context: LiveWorkerTaskContext | null,
): Promise<void> {
  if (!context || !input.removeWorktreeOnExit) return;
  try {
    removeTaskWorktree(input.repoDir, context.taskId);
  } catch (error) {
    input.onCleanupError?.(error);
    await input.reportEvent?.({
      type: "worktree_cleanup_failed",
      taskId: context.taskId,
      payload: {
        error: error instanceof Error ? error.message : String(error),
        failureCode: "cleanup_failed",
      },
    });
  }
}

export async function submitFailedWorkerResult(request: SubmitFailedWorkerResultInput): Promise<void> {
  const taskId = request.taskId ?? request.input.payload.task.id;
  const errorMessage = request.error instanceof Error ? request.error.message : String(request.error);
  try {
    const failedResult = createFailedWorkerResult({
      payload: request.input.payload,
      workerId: request.input.workerId,
      errorMessage,
      generatedAt: nowIso(),
    });
    const failedOutputDir = path.join(request.input.repoDir, ".worktrees", "failed", safeTaskDirName(taskId));
    fs.mkdirSync(failedOutputDir, { recursive: true });
    writeWorkerResultFiles(failedOutputDir, failedResult, `ERROR: ${errorMessage}\n`);
    await submitFailedResultWithRetry(request, failedResult, taskId);
  } catch (fallbackError) {
    const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
    console.error(`failed to submit error result for ${taskId}:`, fallbackMessage);
    await request.onFallbackFailed?.({ taskId, error: fallbackMessage });
    if (fallbackError instanceof WorkerResultDeliveryError) {
      throw fallbackError;
    }
    throw new WorkerResultDeliveryError(`failed to submit error result for ${taskId}: ${fallbackMessage}`);
  }
}

async function submitFailedResultWithRetry(request: SubmitFailedWorkerResultInput, failedResult: WorkerResult, taskId: string): Promise<void> {
  const maxRetries = Number.isSafeInteger(request.maxRetries) && (request.maxRetries ?? 0) > 0
    ? request.maxRetries ?? SUBMIT_RESULT_MAX_RETRIES
    : SUBMIT_RESULT_MAX_RETRIES;
  const retryDelayMs = Number.isSafeInteger(request.retryDelayMs) && (request.retryDelayMs ?? -1) >= 0
    ? request.retryDelayMs ?? SUBMIT_RESULT_RETRY_DELAY_MS
    : SUBMIT_RESULT_RETRY_DELAY_MS;
  let lastError = "unknown delivery error";
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    throwIfAborted(request.input.signal, "worker result delivery aborted");
    try {
      await request.input.client.submitResult(request.input.workerId, {
        ...buildWorkerProtocolEnvelope(request.input.payload),
        result: failedResult,
        changedFiles: [],
        pullRequest: null,
      }, ...requestOptions(request.input.signal));
      console.error(`submitted failed result for ${taskId} after catch`);
      await request.onSubmitted?.({ taskId });
      return;
    } catch (submitError) {
      throwIfAborted(request.input.signal, "worker result delivery aborted");
      const error = submitError instanceof Error ? submitError.message : String(submitError);
      lastError = error;
      console.error(`submitResult in catch attempt ${attempt} failed:`, error);
      await request.onSubmitAttemptFailed?.({ taskId, attempt, maxRetries, error });
      if (attempt < maxRetries) {
        await sleepUntilAborted(
          retryDelayMs,
          request.input.signal,
          "worker result delivery aborted",
        );
      }
    }
  }
  throw new WorkerResultDeliveryError(
    `failed to submit error result for ${taskId} after ${maxRetries} attempts: ${lastError}`,
  );
}
