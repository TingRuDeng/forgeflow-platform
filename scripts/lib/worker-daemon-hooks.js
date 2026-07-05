import { formatLocalTimestamp } from "./time.js";
import { logger, logTaskCompleted, logTaskFailed, } from "./logger.js";
import { recordTaskMetric } from "./metrics.js";
function nowIso() {
    return formatLocalTimestamp();
}
export async function reportWorkerEventBestEffort(client, workerId, event) {
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
    }
    catch (error) {
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
export function logCleanupError(taskId, cleanupError) {
    logger.warn({
        operation: "cleanupWorktree",
        taskId,
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        event: "worktree_cleanup_failed",
    });
}
export function buildManagedTaskCallbacks(input) {
    return {
        onHeartbeatFailed: (event) => {
            logger.error({ operation: "heartbeat", taskId: event.taskId, error: event.error, event: "heartbeat_failed" });
        },
        onCompleted: (event) => {
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
        onFailed: (event) => {
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
export function buildFailedResultCallbacks(input, taskId) {
    return {
        onSubmitted: () => {
            logger.warn({ operation: "submitResult", taskId, event: "failed_result_submitted" });
        },
        onSubmitAttemptFailed: async (event) => {
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
        onFallbackFailed: async (event) => {
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
