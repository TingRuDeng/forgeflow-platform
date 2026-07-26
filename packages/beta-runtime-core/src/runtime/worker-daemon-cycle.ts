import os from "node:os";

import {
  requestOptions,
  sleepUntilAborted,
  throwIfAborted,
} from "./abort-signal.js";
import { nowIso } from "./utils.js";
import { startSingleFlightInterval } from "./single-flight-interval.js";
import type {
  DispatcherClient,
  PullRequestInfo,
  TaskPayload,
  WorkerResult,
} from "./types.js";

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
  signal?: AbortSignal;
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
  const value = Number(process.env.WORKER_DAEMON_SUBMIT_RESULT_MAX_RETRIES);
  return Number.isSafeInteger(value) && value > 0 ? value : SUBMIT_RESULT_MAX_RETRIES;
}

function getSubmitResultRetryDelayMs(): number {
  const value = Number(process.env.WORKER_DAEMON_SUBMIT_RESULT_RETRY_DELAY_MS);
  return Number.isSafeInteger(value) && value >= 0 ? value : SUBMIT_RESULT_RETRY_DELAY_MS;
}

function startTaskHeartbeat(input: {
  client: DispatcherClient;
  workerId: string;
  taskId: string;
  now?: () => string;
  signal?: AbortSignal;
}): () => Promise<void> {
  return startSingleFlightInterval({
    intervalMs: TASK_HEARTBEAT_INTERVAL_MS,
    run: () => input.client.heartbeat(
      input.workerId,
      { at: input.now?.() ?? nowIso() },
      ...requestOptions(input.signal),
    ).then(() => undefined),
    onError: (error) => {
      console.error(`heartbeat failed for task ${input.taskId}:`, error instanceof Error ? error.message : String(error));
    },
  });
}

async function reportWorkerEventBestEffort(
  input: SharedWorkerDaemonCycleInput,
  payload: { type: string; taskId?: string; payload?: unknown; at?: string },
): Promise<void> {
  if (input.signal?.aborted || typeof input.client.reportEvent !== "function") {
    return;
  }
  try {
    await input.client.reportEvent(input.workerId, {
      ...payload,
      at: payload.at ?? resolveNow(input),
    }, ...requestOptions(input.signal));
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
    throwIfAborted(input.cycle.signal, "worker daemon cycle aborted");
    try {
      await input.cycle.client.submitResult(
        input.cycle.workerId,
        input.payload,
        ...requestOptions(input.cycle.signal),
      );
      return;
    } catch (error) {
      if (input.cycle.signal?.aborted) {
        throwIfAborted(input.cycle.signal, "worker daemon cycle aborted");
      }
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
        await sleepUntilAborted(
          retryDelayMs,
          input.cycle.signal,
          "worker daemon cycle aborted",
        );
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
  if (input.cycle.taskExecutor) {
    return input.cycle.taskExecutor.executeTask(
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
}

export async function runSharedWorkerDaemonCycle(
  input: SharedWorkerDaemonCycleInput,
): Promise<SharedWorkerDaemonCycleResult> {
  throwIfAborted(input.signal, "worker daemon cycle aborted");
  const at = input.at ?? resolveNow(input);

  await input.client.registerWorker({
    workerId: input.workerId,
    pool: input.pool,
    hostname: input.hostname ?? os.hostname(),
    labels: input.labels ?? [],
    repoDir: input.repoDir,
    at,
  }, ...requestOptions(input.signal));
  await input.client.heartbeat(input.workerId, { at }, ...requestOptions(input.signal));

  const assigned = await input.client.claimTask(input.workerId, { at }, ...requestOptions(input.signal));
  if (!assigned?.assignment || !assigned.task) {
    return { status: "idle", workerId: input.workerId };
  }

  const taskId = assigned.task.id ?? "unknown";
  const envelope = buildWorkerProtocolEnvelope(assigned);
  await input.client.startTask(
    input.workerId,
    { taskId, ...envelope, at },
    ...requestOptions(input.signal),
  );
  const stopHeartbeat = startTaskHeartbeat({
    client: input.client,
    workerId: input.workerId,
    taskId,
    now: input.now,
    signal: input.signal,
  });
  try {
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
  } finally {
    await stopHeartbeat();
  }
}
