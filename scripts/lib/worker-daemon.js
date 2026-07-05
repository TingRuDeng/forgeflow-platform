import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { handleDispatcherHttpRequest } from "./dispatcher-server.js";
import { formatLocalTimestamp } from "./time.js";
import { logger, logTaskCompleted, logTaskFailed, } from "./logger.js";
import { recordTaskMetric } from "./metrics.js";
import { getDispatcherAuthHeader } from "./dispatcher-auth.js";
function resolveDispatcherDist() {
    const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
    const distPath = path.join(repoRoot, "apps/dispatcher/dist/modules/server/runtime-glue-dispatcher-client.js");
    return { repoRoot, distPath };
}
function ensureDispatcherDist() {
    const { repoRoot, distPath } = resolveDispatcherDist();
    if (fs.existsSync(distPath)) {
        return;
    }
    execSync("pnpm --dir apps/dispatcher run build", {
        cwd: repoRoot,
        stdio: "inherit",
    });
}
async function bootstrapDispatcherBridge() {
    const { repoRoot, distPath } = resolveDispatcherDist();
    if (!fs.existsSync(distPath)) {
        ensureDispatcherDist();
    }
    const distDir = path.join(repoRoot, "apps/dispatcher/dist");
    return import(path.join(distDir, "modules/server/runtime-glue-dispatcher-client.js"));
}
function resolveBetaRuntimeCoreDist() {
    const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
    const distPath = path.join(repoRoot, "packages/beta-runtime-core/dist/runtime/worker-daemon.js");
    return { repoRoot, distPath };
}
function ensureBetaRuntimeCoreDist() {
    const { repoRoot, distPath } = resolveBetaRuntimeCoreDist();
    if (fs.existsSync(distPath)) {
        return;
    }
    execSync("pnpm --filter @tingrudeng/beta-runtime-core build", {
        cwd: repoRoot,
        stdio: "inherit",
    });
}
async function bootstrapBetaRuntimeCore() {
    const { distPath } = resolveBetaRuntimeCoreDist();
    if (!fs.existsSync(distPath)) {
        ensureBetaRuntimeCoreDist();
    }
    return import(pathToFileURL(distPath).href);
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
const HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_TIMEOUT_MS = 5_000;
const HEARTBEAT_MAX_RETRIES = 3;
const HEARTBEAT_RETRY_DELAY_MS = 1_000;
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
    const heartbeatClient = input.client;
    const taskId = input.payload.task.id;
    const workerId = input.workerId;
    let heartbeatIntervalId = null;
    const startTime = Date.now();
    const startHeartbeat = () => {
        heartbeatIntervalId = setInterval(async () => {
            try {
                await heartbeatClient.heartbeat(workerId, { at: nowIso() });
            }
            catch (error) {
                logger.error({ operation: "heartbeat", taskId, error: error instanceof Error ? error.message : String(error), event: "heartbeat_failed" });
            }
        }, HEARTBEAT_INTERVAL_MS);
    };
    const stopHeartbeat = () => {
        if (heartbeatIntervalId) {
            clearInterval(heartbeatIntervalId);
            heartbeatIntervalId = null;
        }
    };
    try {
        startHeartbeat();
        const execution = await betaRuntime.executeLiveWorkerTask({
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
            onCleanupError: (cleanupError) => {
                logger.warn({
                    operation: "cleanupWorktree",
                    taskId,
                    error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
                    event: "worktree_cleanup_failed",
                });
            },
        });
        const durationMs = Date.now() - startTime;
        logTaskCompleted(input.payload.task.id, input.workerId, durationMs, true);
        recordTaskMetric({
            taskId: input.payload.task.id,
            workerId: input.workerId,
            repo: input.payload.assignment.repo,
            status: "completed",
            durationMs,
            startedAt: new Date(Date.now() - durationMs).toISOString(),
        });
        return execution;
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logTaskFailed(input.payload.task.id, input.workerId, errorMessage);
        recordTaskMetric({
            taskId: input.payload.task.id,
            workerId: input.workerId,
            repo: input.payload.assignment.repo,
            status: "failed",
            durationMs: Date.now() - startTime,
            startedAt: new Date(startTime).toISOString(),
        });
        logger.error({ operation: "taskExecution", taskId, error: errorMessage, event: "task_execution_failed" });
        await submitFailedClaimedTaskResult(input, errorMessage);
        throw error;
    }
    finally {
        stopHeartbeat();
    }
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
    });
}
export function createDispatcherClient(dispatcherUrl) {
    const baseUrl = dispatcherUrl.replace(/\/$/, "");
    async function call(method, pathname, body, options = {}) {
        const url = `${baseUrl}${pathname}`;
        const timeoutMs = options.timeout ?? 10_000;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        const authHeaders = getDispatcherAuthHeader();
        try {
            const response = await fetch(url, {
                method,
                headers: {
                    "content-type": "application/json",
                    ...authHeaders,
                },
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            const text = await response.text();
            const json = text ? JSON.parse(text) : {};
            if (!response.ok) {
                throw new Error(json.error || text || `dispatcher request failed: ${method} ${url} -> ${response.status}`);
            }
            return json;
        }
        catch (error) {
            clearTimeout(timeoutId);
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`dispatcher request failed: ${method} ${url} - ${errorMessage}`);
        }
    }
    async function callWithRetry(method, pathname, body, options = {}) {
        const maxRetries = options.maxRetries ?? 0;
        const retryDelayMs = options.retryDelayMs ?? 1_000;
        let lastError = null;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return await call(method, pathname, body, options);
            }
            catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                if (attempt < maxRetries) {
                    await sleep(retryDelayMs);
                }
            }
        }
        throw lastError;
    }
    return {
        registerWorker(worker) {
            return call("POST", "/api/workers/register", worker);
        },
        heartbeat(workerId, payload) {
            return callWithRetry("POST", `/api/workers/${encodeURIComponent(workerId)}/heartbeat`, payload, {
                timeout: HEARTBEAT_TIMEOUT_MS,
                maxRetries: HEARTBEAT_MAX_RETRIES,
                retryDelayMs: HEARTBEAT_RETRY_DELAY_MS,
            });
        },
        getAssignedTask(workerId) {
            return call("GET", `/api/workers/${encodeURIComponent(workerId)}/assigned-task`);
        },
        claimTask(workerId, payload = {}) {
            return call("POST", `/api/workers/${encodeURIComponent(workerId)}/claim-task`, payload);
        },
        startTask(workerId, payload) {
            return call("POST", `/api/workers/${encodeURIComponent(workerId)}/start-task`, payload);
        },
        submitResult(workerId, payload) {
            return call("POST", `/api/workers/${encodeURIComponent(workerId)}/result`, payload);
        },
        reportEvent(workerId, payload) {
            return call("POST", `/api/workers/${encodeURIComponent(workerId)}/events`, payload);
        },
    };
}
function readStateDirResponseJson(response) {
    if (response.status >= 400) {
        const error = response.json && typeof response.json === "object" && "error" in response.json
            ? String(response.json.error)
            : `dispatcher state-dir request failed: ${response.status}`;
        throw new Error(error);
    }
    return response.json;
}
async function callStateDirDispatcher(stateDir, method, pathname, body) {
    const response = await handleDispatcherHttpRequest({
        stateDir,
        method,
        pathname,
        body,
        clientAddress: "127.0.0.1",
        internalCall: true,
    });
    return readStateDirResponseJson(response);
}
export function createStateDirDispatcherClient(stateDir) {
    return {
        registerWorker(worker) {
            return callStateDirDispatcher(stateDir, "POST", "/api/workers/register", worker);
        },
        heartbeat(workerId, payload) {
            return callStateDirDispatcher(stateDir, "POST", `/api/workers/${encodeURIComponent(workerId)}/heartbeat`, payload);
        },
        getAssignedTask(workerId) {
            return callStateDirDispatcher(stateDir, "GET", `/api/workers/${encodeURIComponent(workerId)}/assigned-task`);
        },
        claimTask(workerId, payload = {}) {
            return callStateDirDispatcher(stateDir, "POST", `/api/workers/${encodeURIComponent(workerId)}/claim-task`, payload);
        },
        startTask(workerId, payload) {
            return callStateDirDispatcher(stateDir, "POST", `/api/workers/${encodeURIComponent(workerId)}/start-task`, payload);
        },
        submitResult(workerId, payload) {
            return callStateDirDispatcher(stateDir, "POST", `/api/workers/${encodeURIComponent(workerId)}/result`, payload);
        },
        reportEvent(workerId, payload) {
            return callStateDirDispatcher(stateDir, "POST", `/api/workers/${encodeURIComponent(workerId)}/events`, payload);
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
