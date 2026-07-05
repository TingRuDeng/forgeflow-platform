import path from "node:path";
import { handleDispatcherHttpRequest } from "./dispatcher-server.js";
import { formatLocalTimestamp } from "./time.js";
import { importDispatcherRuntimeBridge, importWorkerDaemonRuntime, } from "./runtime-bootstrap.js";
import { logger, logTaskCompleted, logTaskFailed, } from "./logger.js";
import { recordTaskMetric } from "./metrics.js";
async function bootstrapDispatcherBridge() {
    return importDispatcherRuntimeBridge();
}
async function bootstrapBetaRuntimeCore() {
    return importWorkerDaemonRuntime();
}
function nowIso() {
    return formatLocalTimestamp();
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function reportWorkerEventBestEffort(client, workerId, event) {
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
const SUBMIT_RESULT_MAX_RETRIES = 3;
const SUBMIT_RESULT_RETRY_DELAY_MS = 2_000;
function getSubmitResultMaxRetries() {
    return Number(process.env.WORKER_DAEMON_SUBMIT_RESULT_MAX_RETRIES || SUBMIT_RESULT_MAX_RETRIES);
}
function getSubmitResultRetryDelayMs() {
    return Number(process.env.WORKER_DAEMON_SUBMIT_RESULT_RETRY_DELAY_MS || SUBMIT_RESULT_RETRY_DELAY_MS);
}
function buildWorkerProtocolEnvelope(payload) {
    return {
        attemptId: payload.attemptId,
        leaseToken: payload.leaseToken,
        protocolVersion: payload.protocolVersion,
        traceId: payload.traceId,
        idempotencyKey: payload.idempotencyKey,
    };
}
async function executeClaimedTask(input) {
    const betaRuntime = await bootstrapBetaRuntimeCore();
    const taskId = input.payload.task.id;
    const workerId = input.workerId;
    return betaRuntime.executeManagedWorkerTask({
        client: input.client,
        packageRoot: input.repoRoot,
        workerId,
        repoDir: input.repoDir,
        payload: input.payload,
        dryRunExecution: input.dryRunExecution,
        at: input.at,
        createPullRequest: process.env.FORGEFLOW_WORKER_CREATE_PR === "1",
        removeWorktreeOnExit: process.env.FORGEFLOW_WORKER_REMOVE_WORKTREE_ON_EXIT === "1",
        resetWorktreeOnReuse: true,
        runtimeScriptPath: path.join(input.repoRoot, "scripts/run-worker-assignment.js"),
        runtimeScriptCwd: input.repoRoot,
        reportEvent: (event) => reportWorkerEventBestEffort(input.client, input.workerId, event),
        onCleanupError: (cleanupError) => logCleanupError(taskId, cleanupError),
        maxFailedResultRetries: getSubmitResultMaxRetries(),
        failedResultRetryDelayMs: getSubmitResultRetryDelayMs(),
        callbacks: buildManagedTaskCallbacks(input),
        failedResultCallbacks: buildFailedResultCallbacks(input, taskId),
    });
}
async function submitFailedClaimedTaskResult(input, errorMessage) {
    const taskId = input.payload.task.id;
    const betaRuntime = await bootstrapBetaRuntimeCore();
    await betaRuntime.submitFailedWorkerResult({
        input,
        taskId,
        error: errorMessage,
        maxRetries: getSubmitResultMaxRetries(),
        retryDelayMs: getSubmitResultRetryDelayMs(),
        ...buildFailedResultCallbacks(input, taskId),
    });
}
function logCleanupError(taskId, cleanupError) {
    logger.warn({
        operation: "cleanupWorktree",
        taskId,
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        event: "worktree_cleanup_failed",
    });
}
function buildManagedTaskCallbacks(input) {
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
function buildFailedResultCallbacks(input, taskId) {
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
export function createDispatcherClient(dispatcherUrl) {
    let clientPromise = null;
    return createLazyDispatcherClient(() => {
        clientPromise ??= bootstrapDispatcherBridge()
            .then((bridge) => bridge.createDispatcherHttpClient({ dispatcherUrl }));
        return clientPromise;
    });
}
export function createStateDirDispatcherClient(stateDir) {
    let clientPromise = null;
    return createLazyDispatcherClient(() => {
        clientPromise ??= bootstrapDispatcherBridge().then((bridge) => {
            const createClient = bridge.createDispatcherStateDirClientFactory({
                handleRequest: (input) => handleDispatcherHttpRequest({
                    stateDir: input.stateDir,
                    method: input.method,
                    pathname: input.pathname,
                    body: input.body,
                    clientAddress: "127.0.0.1",
                    internalCall: input.internalCall ?? true,
                }),
            });
            return createClient(stateDir);
        });
        return clientPromise;
    });
}
function createLazyDispatcherClient(resolveClient) {
    return {
        async registerWorker(worker) {
            return (await resolveClient()).registerWorker(worker);
        },
        async heartbeat(workerId, payload) {
            return (await resolveClient()).heartbeat(workerId, payload);
        },
        async getAssignedTask(workerId) {
            return (await resolveClient()).getAssignedTask(workerId);
        },
        async claimTask(workerId, payload = {}) {
            return (await resolveClient()).claimTask(workerId, payload);
        },
        async startTask(workerId, payload) {
            return (await resolveClient()).startTask(workerId, payload);
        },
        async submitResult(workerId, payload) {
            return (await resolveClient()).submitResult(workerId, payload);
        },
        async reportEvent(workerId, payload) {
            return (await resolveClient()).reportEvent?.(workerId, payload);
        },
    };
}
function buildClaimedTaskPayload(task, assignment, assigned) {
    return {
        task,
        assignment,
        ...buildWorkerProtocolEnvelope(assigned),
    };
}
export async function runWorkerDaemonCycle(input) {
    const client = input.client ?? createDispatcherClient(input.dispatcherUrl || "");
    const bridge = await bootstrapDispatcherBridge();
    let claimedPayload = null;
    try {
        return await bridge.runWorkerDaemonCycle({
            client,
            workerId: input.workerId,
            pool: input.pool,
            hostname: input.hostname,
            labels: input.labels,
            repoDir: input.repoDir,
            dryRunExecution: input.dryRunExecution,
            at: input.at,
            taskExecutor: {
                executeTask: (task, assignment, assigned) => {
                    claimedPayload = buildClaimedTaskPayload(task, assignment, assigned);
                    return executeClaimedTask({
                        client,
                        repoRoot: input.repoRoot ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), "../.."),
                        workerId: input.workerId,
                        repoDir: input.repoDir,
                        payload: claimedPayload,
                        dryRunExecution: Boolean(input.dryRunExecution),
                        at: input.at,
                    });
                },
            },
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (claimedPayload && message.startsWith("submitResult failed after")) {
            await submitFailedClaimedTaskResult({
                client,
                repoRoot: input.repoRoot ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), "../.."),
                workerId: input.workerId,
                repoDir: input.repoDir,
                payload: claimedPayload,
                dryRunExecution: Boolean(input.dryRunExecution),
                at: input.at,
            }, message);
        }
        throw error;
    }
}
export async function runWorkerDaemon(input) {
    while (true) {
        const summary = await runWorkerDaemonCycle(input);
        if (input.once) {
            return summary;
        }
        await sleep(input.pollIntervalMs ?? 5000);
    }
}
