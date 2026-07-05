import fs from "node:fs";
import path from "node:path";

import { safeTaskDirName, prepareTaskWorktree, removeTaskWorktree } from "./task-worktree.js";
import { nowIso, sleep } from "./utils.js";
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

const HEARTBEAT_INTERVAL_MS = 10_000;
const SUBMIT_RESULT_MAX_RETRIES = 3;
const SUBMIT_RESULT_RETRY_DELAY_MS = 2_000;

interface TaskExecutionResult {
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

interface TaskSummaryInput extends TaskExecutionResult {
  input: ProcessTaskAssignmentInput;
}

interface SubmitCompletedResultInput {
  input: ProcessTaskAssignmentInput;
  result: WorkerResult;
  changedFiles: string[];
  pullRequest: PullRequestInfo | null;
}

export interface LiveWorkerTaskEvent {
  type: string;
  taskId?: string;
  payload?: unknown;
}

export interface ExecuteLiveWorkerTaskInput extends ProcessTaskAssignmentInput {
  createPullRequest?: boolean;
  removeWorktreeOnExit?: boolean;
  resetWorktreeOnReuse?: boolean;
  runtimeScriptPath?: string;
  runtimeScriptCwd?: string;
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

export async function processTaskAssignment(input: ProcessTaskAssignmentInput): Promise<{
  status: string;
  taskId: string;
  workerId: string;
  worktreeDir: string;
  outputDir: string;
  changedFiles: string[];
  pullRequest: PullRequestInfo | null;
}> {
  const taskId = input.payload.task.id;
  const stopHeartbeat = startTaskHeartbeat(input, taskId);
  try {
    await input.client.startTask(input.workerId, {
      taskId,
      ...buildWorkerProtocolEnvelope(input.payload),
      at: input.at ?? nowIso(),
    });
    const result = await executeLiveWorkerTask(input);
    stopHeartbeat();
    await submitCompletedResult({ input, ...result });
    return buildTaskSummary({ input, ...result });
  } catch (error) {
    stopHeartbeat();
    await submitFailedResult(input, taskId, error);
    throw error;
  }
}

function startTaskHeartbeat(input: ProcessTaskAssignmentInput, taskId: string): () => void {
  const intervalId = setInterval(async () => {
    try {
      await input.client.heartbeat(input.workerId, { at: nowIso() });
    } catch (error) {
      console.error(`heartbeat failed for task ${taskId}:`, error instanceof Error ? error.message : String(error));
    }
  }, HEARTBEAT_INTERVAL_MS);
  return () => clearInterval(intervalId);
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
    runtimeScriptPath: input.runtimeScriptPath,
    runtimeScriptCwd: input.runtimeScriptCwd,
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

async function submitCompletedResult(submission: SubmitCompletedResultInput): Promise<void> {
  const { input } = submission;
  let lastError: string | null = null;
  for (let attempt = 1; attempt <= SUBMIT_RESULT_MAX_RETRIES; attempt++) {
    try {
      await input.client.submitResult(input.workerId, {
        ...buildWorkerProtocolEnvelope(input.payload),
        result: submission.result,
        changedFiles: submission.changedFiles,
        pullRequest: submission.pullRequest,
      });
      lastError = null;
      break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.error(`submitResult attempt ${attempt}/${SUBMIT_RESULT_MAX_RETRIES} failed for task ${input.payload.task.id}:`, lastError);
      if (attempt < SUBMIT_RESULT_MAX_RETRIES) {
        await sleep(SUBMIT_RESULT_RETRY_DELAY_MS);
      }
    }
  }
  if (lastError) {
    console.error(`all submitResult retries failed for task ${input.payload.task.id}, worker may need manual recovery:`, lastError);
  }
}

async function submitFailedResult(input: ProcessTaskAssignmentInput, taskId: string, error: unknown): Promise<void> {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error(`task execution failed for ${taskId}:`, errorMessage);
  try {
    const failedResult = createFailedWorkerResult({
      payload: input.payload,
      workerId: input.workerId,
      errorMessage,
      generatedAt: nowIso(),
    });
    const failedOutputDir = path.join(input.repoDir, ".worktrees", "failed", safeTaskDirName(taskId));
    fs.mkdirSync(failedOutputDir, { recursive: true });
    writeWorkerResultFiles(failedOutputDir, failedResult, `ERROR: ${errorMessage}\n`);
    await submitFailedResultWithRetry(input, failedResult, taskId);
  } catch (fallbackError) {
    console.error(`failed to submit error result for ${taskId}:`, fallbackError instanceof Error ? fallbackError.message : String(fallbackError));
  }
}

async function submitFailedResultWithRetry(input: ProcessTaskAssignmentInput, failedResult: WorkerResult, taskId: string): Promise<void> {
  for (let attempt = 1; attempt <= SUBMIT_RESULT_MAX_RETRIES; attempt++) {
    try {
      await input.client.submitResult(input.workerId, {
        ...buildWorkerProtocolEnvelope(input.payload),
        result: failedResult,
        changedFiles: [],
        pullRequest: null,
      });
      console.error(`submitted failed result for ${taskId} after catch`);
      return;
    } catch (submitError) {
      console.error(`submitResult in catch attempt ${attempt} failed:`, submitError instanceof Error ? submitError.message : String(submitError));
      if (attempt < SUBMIT_RESULT_MAX_RETRIES) {
        await sleep(SUBMIT_RESULT_RETRY_DELAY_MS);
      }
    }
  }
}

function buildTaskSummary(summary: TaskSummaryInput) {
  return {
    status: "completed",
    taskId: summary.input.payload.task.id,
    workerId: summary.input.workerId,
    worktreeDir: summary.worktreeDir,
    outputDir: summary.outputDir,
    changedFiles: summary.changedFiles,
    pullRequest: summary.pullRequest,
  };
}
