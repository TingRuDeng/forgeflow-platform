import { formatLocalTimestamp } from "./time.js";
import {
  logger,
  logTaskCompleted,
  logTaskFailed,
} from "./logger.js";
import { recordTaskMetric } from "./metrics.js";

interface WorkerDaemonHookClient {
  reportEvent?: (
    workerId: string,
    payload: { type: string; taskId?: string; payload?: unknown; at?: string },
  ) => Promise<unknown>;
}

interface WorkerDaemonHookInput {
  client: WorkerDaemonHookClient;
  workerId: string;
  payload: {
    assignment: {
      repo: string;
    };
  };
}

function nowIso(): string {
  return formatLocalTimestamp();
}

export async function reportWorkerEventBestEffort(
  client: WorkerDaemonHookClient,
  workerId: string,
  event: { type: string; taskId?: string; payload?: unknown; at?: string },
): Promise<void> {
  if (typeof client.reportEvent !== "function") {
    return;
  }
  try {
    await client.reportEvent(workerId, {
      type: event.type,
      taskId: event.taskId,
      payload: event.payload,
      at: event.at ?? nowIso(),
    });
  } catch (error) {
    logger.warn({
      operation: "reportWorkerEvent",
      workerId,
      taskId: event.taskId,
      eventType: event.type,
      error: error instanceof Error ? error.message : String(error),
      event: "worker_event_report_failed",
    });
  }
}

export function logCleanupError(taskId: string, cleanupError: unknown): void {
  logger.warn({
    operation: "cleanupWorktree",
    taskId,
    error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
    event: "worktree_cleanup_failed",
  });
}

export function buildManagedTaskCallbacks(input: WorkerDaemonHookInput) {
  return {
    onHeartbeatFailed: (event: { taskId: string; error: string }) => {
      logger.error({ operation: "heartbeat", taskId: event.taskId, error: event.error, event: "heartbeat_failed" });
    },
    onCompleted: (event: { taskId: string; workerId: string; durationMs: number }) => {
      logTaskCompleted(event.taskId, event.workerId, event.durationMs, true);
      recordTaskMetric({
        taskId: event.taskId,
        workerId: event.workerId,
        repo: input.payload.assignment.repo,
        status: "completed",
        durationMs: event.durationMs,
        startedAt: new Date(Date.now() - event.durationMs).toISOString(),
      });
    },
    onFailed: (event: { taskId: string; workerId: string; error: string; durationMs: number; startedAt: string }) => {
      logTaskFailed(event.taskId, event.workerId, event.error);
      recordTaskMetric({
        taskId: event.taskId,
        workerId: event.workerId,
        repo: input.payload.assignment.repo,
        status: "failed",
        durationMs: event.durationMs,
        startedAt: event.startedAt,
      });
      logger.error({ operation: "taskExecution", taskId: event.taskId, error: event.error, event: "task_execution_failed" });
    },
  };
}

export function buildFailedResultCallbacks(input: WorkerDaemonHookInput, taskId: string) {
  return {
    onSubmitted: () => {
      logger.warn({ operation: "submitResult", taskId, event: "failed_result_submitted" });
    },
    onSubmitAttemptFailed: async (event: { attempt: number; maxRetries: number; error: string }) => {
      logger.error({ operation: "submitResult", taskId, attempt: event.attempt, error: event.error, event: "submitResult_catch_failed" });
      await reportWorkerEventBestEffort(input.client, input.workerId, {
        type: "submit_result_retry_failed",
        taskId,
        payload: {
          attempt: event.attempt,
          maxRetries: event.maxRetries,
          error: event.error,
          fallback: true,
        },
      });
    },
    onFallbackFailed: async (event: { error: string }) => {
      logger.error({ operation: "submitResult", taskId, error: event.error, event: "submitResult_fallback_failed" });
      await reportWorkerEventBestEffort(input.client, input.workerId, {
        type: "delivery_failed",
        taskId,
        payload: {
          stage: "failed_result_fallback",
          error: event.error,
          failureCode: "delivery_failed",
        },
      });
    },
  };
}
