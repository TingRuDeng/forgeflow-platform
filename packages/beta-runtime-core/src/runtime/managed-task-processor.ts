import { executeLiveWorkerTask, submitFailedWorkerResult } from "./task-processor.js";
import { nowIso } from "./utils.js";
import type {
  ExecuteLiveWorkerTaskInput,
  SubmitFailedWorkerResultInput,
  TaskExecutionResult,
} from "./task-processor.js";

const DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000;

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
  maxFailedResultRetries?: number;
  failedResultRetryDelayMs?: number;
  callbacks?: ManagedWorkerTaskCallbacks;
  failedResultCallbacks?: Pick<
    SubmitFailedWorkerResultInput,
    "onSubmitted" | "onSubmitAttemptFailed" | "onFallbackFailed"
  >;
}

export async function executeManagedWorkerTask(input: ExecuteManagedWorkerTaskInput): Promise<TaskExecutionResult> {
  const taskId = input.payload.task.id;
  const startedAtMs = Date.now();
  const stopHeartbeat = startManagedHeartbeat(input, taskId);
  let result: TaskExecutionResult;
  try {
    result = await executeLiveWorkerTask(input);
    stopHeartbeat();
  } catch (error) {
    stopHeartbeat();
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

function startManagedHeartbeat(input: ExecuteManagedWorkerTaskInput, taskId: string): () => void {
  const intervalId = setInterval(async () => {
    try {
      await input.client.heartbeat(input.workerId, { at: nowIso() });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await input.callbacks?.onHeartbeatFailed?.({ taskId, error: message });
    }
  }, input.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS);
  return () => clearInterval(intervalId);
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
