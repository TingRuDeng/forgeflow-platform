import os from "node:os";

import { nowIso, sleep } from "./utils.js";
import type { DispatcherClient, PullRequestInfo, TaskPayload, WorkerResult } from "./types.js";

const SUBMIT_RESULT_MAX_RETRIES = 3;
const SUBMIT_RESULT_RETRY_DELAY_MS = 2_000;
const TASK_HEARTBEAT_INTERVAL_MS = 10_000;

export interface TaskExecutionResult {
  result: WorkerResult | unknown;
  changedFiles: string[];
  pullRequest: PullRequestInfo | null;
  worktreeDir?: string;
  outputDir?: string;
}

export interface TaskExecutor {
  executeTask(task: unknown, assignment: unknown, assigned: TaskPayload): Promise<TaskExecutionResult>;
}

export interface SharedWorkerDaemonCycleInput {
  client: DispatcherClient;
  workerId: string;
  pool: string;
  hostname?: string;
  labels?: string[];
  repoDir: string;
  dryRunExecution?: boolean;
  taskExecutor?: TaskExecutor;
  at?: string;
  now?: () => string;
}

export type SharedWorkerDaemonCycleResult =
  | { status: "idle"; workerId: string }
  | {
    status: "completed";
    taskId: string;
    workerId: string;
    worktreeDir?: string;
    outputDir?: string;
    changedFiles: string[];
    pullRequest: PullRequestInfo | null;
  };

function resolveNow(input: Pick<SharedWorkerDaemonCycleInput, "now">): string {
  return input.now?.() ?? nowIso();
}

function buildWorkerProtocolEnvelope(assigned: TaskPayload) {
  return {
    attemptId: assigned.attemptId,
    leaseToken: assigned.leaseToken,
    protocolVersion: assigned.protocolVersion,
    traceId: assigned.traceId,
    idempotencyKey: assigned.idempotencyKey,
  };
}

function getSubmitResultMaxRetries(): number {
  return Number(process.env.WORKER_DAEMON_SUBMIT_RESULT_MAX_RETRIES || SUBMIT_RESULT_MAX_RETRIES);
}

function getSubmitResultRetryDelayMs(): number {
  return Number(process.env.WORKER_DAEMON_SUBMIT_RESULT_RETRY_DELAY_MS || SUBMIT_RESULT_RETRY_DELAY_MS);
}

function startTaskHeartbeat(input: {
  client: DispatcherClient;
  workerId: string;
  taskId: string;
  now?: () => string;
}): () => void {
  const intervalId = setInterval(async () => {
    try {
      await input.client.heartbeat(input.workerId, { at: input.now?.() ?? nowIso() });
    } catch (error) {
      console.error(`heartbeat failed for task ${input.taskId}:`, error instanceof Error ? error.message : String(error));
    }
  }, TASK_HEARTBEAT_INTERVAL_MS);
  return () => clearInterval(intervalId);
}

async function reportWorkerEventBestEffort(
  input: SharedWorkerDaemonCycleInput,
  payload: { type: string; taskId?: string; payload?: unknown; at?: string },
): Promise<void> {
  if (typeof input.client.reportEvent !== "function") {
    return;
  }
  try {
    await input.client.reportEvent(input.workerId, {
      ...payload,
      at: payload.at ?? resolveNow(input),
    });
  } catch {
    // 事件回报是诊断增强，不能遮蔽主链 submitResult 的真实失败。
  }
}

async function submitResultWithRetry(input: {
  cycle: SharedWorkerDaemonCycleInput;
  taskId: string;
  payload: {
    result: WorkerResult;
    changedFiles: string[];
    pullRequest: PullRequestInfo | null;
    attemptId?: string;
    leaseToken?: string;
    protocolVersion?: string;
    traceId?: string;
    idempotencyKey?: string;
  };
}): Promise<void> {
  const maxRetries = getSubmitResultMaxRetries();
  const retryDelayMs = getSubmitResultRetryDelayMs();
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      await input.cycle.client.submitResult(input.cycle.workerId, input.payload);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await reportWorkerEventBestEffort(input.cycle, {
        type: "submit_result_retry_failed",
        taskId: input.taskId,
        payload: {
          attempt,
          maxRetries,
          error: lastError,
        },
      });
      if (attempt < maxRetries) {
        await sleep(retryDelayMs);
      }
    }
  }

  await reportWorkerEventBestEffort(input.cycle, {
    type: "delivery_failed",
    taskId: input.taskId,
    payload: {
      stage: "submit_result",
      error: lastError,
      failureCode: "delivery_failed",
    },
  });
  throw new Error(`submitResult failed after ${maxRetries} attempts: ${lastError}`);
}

async function executeAssignedTask(input: {
  cycle: SharedWorkerDaemonCycleInput;
  assigned: TaskPayload;
  taskId: string;
}): Promise<TaskExecutionResult> {
  const stopHeartbeat = startTaskHeartbeat({
    client: input.cycle.client,
    workerId: input.cycle.workerId,
    taskId: input.taskId,
    now: input.cycle.now,
  });
  try {
    if (input.cycle.taskExecutor) {
      return await input.cycle.taskExecutor.executeTask(
        input.assigned.task,
        input.assigned.assignment,
        input.assigned,
      );
    }
    if (input.cycle.dryRunExecution) {
      return {
        result: { dryRun: true, taskId: input.taskId },
        changedFiles: [],
        pullRequest: null,
      };
    }
    throw new Error("taskExecutor is required when dryRunExecution is false");
  } finally {
    stopHeartbeat();
  }
}

export async function runSharedWorkerDaemonCycle(
  input: SharedWorkerDaemonCycleInput,
): Promise<SharedWorkerDaemonCycleResult> {
  const at = input.at ?? resolveNow(input);

  await input.client.registerWorker({
    workerId: input.workerId,
    pool: input.pool,
    hostname: input.hostname ?? os.hostname(),
    labels: input.labels ?? [],
    repoDir: input.repoDir,
    at,
  });
  await input.client.heartbeat(input.workerId, { at });

  const assigned = await input.client.claimTask(input.workerId, { at });
  if (!assigned?.assignment || !assigned.task) {
    return { status: "idle", workerId: input.workerId };
  }

  const taskId = assigned.task.id ?? "unknown";
  const envelope = buildWorkerProtocolEnvelope(assigned);
  await input.client.startTask(input.workerId, { taskId, ...envelope, at });

  const executionResult = await executeAssignedTask({ cycle: input, assigned, taskId });
  await submitResultWithRetry({
    cycle: input,
    taskId,
    payload: {
      ...envelope,
      result: executionResult.result as WorkerResult,
      changedFiles: executionResult.changedFiles,
      pullRequest: executionResult.pullRequest,
    },
  });

  return {
    status: "completed",
    workerId: input.workerId,
    taskId,
    worktreeDir: executionResult.worktreeDir,
    outputDir: executionResult.outputDir,
    changedFiles: executionResult.changedFiles,
    pullRequest: executionResult.pullRequest,
  };
}
