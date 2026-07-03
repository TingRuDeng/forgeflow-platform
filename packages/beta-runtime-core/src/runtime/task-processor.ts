import fs from "node:fs";
import path from "node:path";

import { safeTaskDirName, prepareTaskWorktree } from "./task-worktree.js";
import { nowIso, sleep } from "./utils.js";
import {
  buildDryRunWorkerResult,
  collectChangedFiles,
  createFailedWorkerResult,
  materializeAssignmentPackage,
  maybeCommitAndPush,
  maybeCreatePullRequest,
  runWorkerAssignmentScript,
  writeWorkerResultFiles,
} from "./task-output.js";
import type { PullRequestInfo, ProcessTaskAssignmentInput, TaskPayload, WorkerProtocolEnvelope, WorkerResult } from "./types.js";

const HEARTBEAT_INTERVAL_MS = 10_000;
const SUBMIT_RESULT_MAX_RETRIES = 3;
const SUBMIT_RESULT_RETRY_DELAY_MS = 2_000;

interface TaskExecutionResult {
  worktreeDir: string;
  outputDir: string;
  workerResult: WorkerResult;
  changedFiles: string[];
  pullRequest: PullRequestInfo | null;
}

interface TaskSummaryInput extends TaskExecutionResult {
  input: ProcessTaskAssignmentInput;
}

interface SubmitCompletedResultInput {
  input: ProcessTaskAssignmentInput;
  workerResult: WorkerResult;
  changedFiles: string[];
  pullRequest: PullRequestInfo | null;
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
    const result = await runTaskExecution(input);
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

async function runTaskExecution(input: ProcessTaskAssignmentInput): Promise<TaskExecutionResult> {
  const worktreeDir = prepareTaskWorktree(input.repoDir, input.payload.assignment, { allowReuse: true });
  const assignmentDir = materializeAssignmentPackage(worktreeDir, input.payload);
  const outputDir = path.join(assignmentDir, "execution");
  fs.mkdirSync(outputDir, { recursive: true });
  const workerResult = input.dryRunExecution
    ? buildDryRunWorkerResult(input.payload, outputDir, input.at ?? nowIso())
    : await runWorkerAssignmentScript({ packageRoot: input.packageRoot, assignmentDir, worktreeDir, outputDir });
  const changedFiles = input.dryRunExecution ? [] : collectChangedFiles(worktreeDir);
  if (!input.dryRunExecution) {
    maybeCommitAndPush(worktreeDir, input.payload, changedFiles);
  }
  const pullRequest = input.dryRunExecution ? null : await maybeCreatePullRequest(input.payload, changedFiles);
  return { worktreeDir, outputDir, workerResult, changedFiles, pullRequest };
}

async function submitCompletedResult(submission: SubmitCompletedResultInput): Promise<void> {
  const { input } = submission;
  let lastError: string | null = null;
  for (let attempt = 1; attempt <= SUBMIT_RESULT_MAX_RETRIES; attempt++) {
    try {
      await input.client.submitResult(input.workerId, {
        ...buildWorkerProtocolEnvelope(input.payload),
        result: submission.workerResult,
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
