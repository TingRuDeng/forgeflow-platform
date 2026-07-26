import { requestOptions } from "./abort-signal.js";
import { executeLiveWorkerTask, submitFailedWorkerResult } from "./task-processor.js";
import { nowIso } from "./utils.js";
import { startSingleFlightInterval } from "./single-flight-interval.js";
import type {
  ExecuteLiveWorkerTaskInput,
  SubmitFailedWorkerResultInput,
  TaskExecutionResult,
} from "./task-processor.js";

const DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000;
export const DEFAULT_SUBMIT_RESULT_MAX_RETRIES = 3;
export const DEFAULT_SUBMIT_RESULT_RETRY_DELAY_MS = 2_000;

export interface ManagedWorkerTaskCallbacks {
  onHeartbeatFailed?: (event: { taskId: string; error: string }) => void | Promise<void>;
  onCompleted?: (event: { taskId: string; workerId: string; durationMs: number }) => void | Promise<void>;
  onFailed?: (event: {
    taskId: string;
    workerId: string;
    error: string;
    durationMs: number;
    startedAt: string;
  }) => void | Promise<void>;
}

export interface ExecuteManagedWorkerTaskInput extends ExecuteLiveWorkerTaskInput {
  heartbeatIntervalMs?: number;
  heartbeatManagedExternally?: boolean;
  maxFailedResultRetries?: number;
  failedResultRetryDelayMs?: number;
  callbacks?: ManagedWorkerTaskCallbacks;
  failedResultCallbacks?: Pick<
    SubmitFailedWorkerResultInput,
    "onSubmitted" | "onSubmitAttemptFailed" | "onFallbackFailed"
  >;
}

export function resolveManagedWorkerTaskRetryPolicy(env: NodeJS.ProcessEnv = process.env): {
  maxFailedResultRetries: number;
  failedResultRetryDelayMs: number;
} {
  const maxRetries = Number(env.WORKER_DAEMON_SUBMIT_RESULT_MAX_RETRIES);
  const retryDelayMs = Number(env.WORKER_DAEMON_SUBMIT_RESULT_RETRY_DELAY_MS);
  return {
    maxFailedResultRetries: Number.isSafeInteger(maxRetries) && maxRetries > 0
      ? maxRetries
      : DEFAULT_SUBMIT_RESULT_MAX_RETRIES,
    failedResultRetryDelayMs: Number.isSafeInteger(retryDelayMs) && retryDelayMs >= 0
      ? retryDelayMs
      : DEFAULT_SUBMIT_RESULT_RETRY_DELAY_MS,
  };
}

export async function executeManagedWorkerTask(input: ExecuteManagedWorkerTaskInput): Promise<TaskExecutionResult> {
  const taskId = input.payload.task.id;
  const startedAtMs = Date.now();
  const stopHeartbeat = input.heartbeatManagedExternally
    ? async () => {}
    : startManagedHeartbeat(input, taskId);
  let result: TaskExecutionResult;
  try {
    result = await executeLiveWorkerTask(input);
    await stopHeartbeat();
  } catch (error) {
    await stopHeartbeat();
    const errorMessage = error instanceof Error ? error.message : String(error);
    await handleManagedFailure(input, taskId, startedAtMs, errorMessage);
    throw error;
  }
  await input.callbacks?.onCompleted?.({
    taskId,
    workerId: input.workerId,
    durationMs: Date.now() - startedAtMs,
  });
  return result;
}

function startManagedHeartbeat(input: ExecuteManagedWorkerTaskInput, taskId: string): () => Promise<void> {
  return startSingleFlightInterval({
    intervalMs: input.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
    run: () => input.client.heartbeat(
      input.workerId,
      { at: nowIso() },
      ...requestOptions(input.signal),
    ).then(() => undefined),
    onError: async (error) => {
      const message = error instanceof Error ? error.message : String(error);
      await input.callbacks?.onHeartbeatFailed?.({ taskId, error: message });
    },
  });
}

async function handleManagedFailure(
  input: ExecuteManagedWorkerTaskInput,
  taskId: string,
  startedAtMs: number,
  errorMessage: string,
): Promise<void> {
  await input.callbacks?.onFailed?.({
    taskId,
    workerId: input.workerId,
    error: errorMessage,
    durationMs: Date.now() - startedAtMs,
    startedAt: new Date(startedAtMs).toISOString(),
  });
  await submitFailedWorkerResult({
    input,
    taskId,
    error: errorMessage,
    maxRetries: input.maxFailedResultRetries,
    retryDelayMs: input.failedResultRetryDelayMs,
    ...input.failedResultCallbacks,
  });
}
