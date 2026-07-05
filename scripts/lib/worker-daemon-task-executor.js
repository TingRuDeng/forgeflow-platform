import path from "node:path";
import { importWorkerDaemonRuntime } from "./runtime-bootstrap.js";
import { buildFailedResultCallbacks, buildManagedTaskCallbacks, logCleanupError, reportWorkerEventBestEffort, } from "./worker-daemon-hooks.js";
import { buildWorkerProtocolEnvelope, } from "./worker-daemon-types.js";
const SUBMIT_RESULT_MAX_RETRIES = 3;
const SUBMIT_RESULT_RETRY_DELAY_MS = 2_000;
async function bootstrapBetaRuntimeCore() {
    return importWorkerDaemonRuntime();
}
function getSubmitResultMaxRetries() {
    return Number(process.env.WORKER_DAEMON_SUBMIT_RESULT_MAX_RETRIES || SUBMIT_RESULT_MAX_RETRIES);
}
function getSubmitResultRetryDelayMs() {
    return Number(process.env.WORKER_DAEMON_SUBMIT_RESULT_RETRY_DELAY_MS || SUBMIT_RESULT_RETRY_DELAY_MS);
}
export function buildClaimedTaskPayload(task, assignment, assigned) {
    return {
        task,
        assignment,
        ...buildWorkerProtocolEnvelope(assigned),
    };
}
export async function executeClaimedTask(input) {
    const betaRuntime = await bootstrapBetaRuntimeCore();
    const taskId = input.payload.task.id;
    return betaRuntime.executeManagedWorkerTask({
        client: input.client,
        packageRoot: input.repoRoot,
        workerId: input.workerId,
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
export async function submitFailedClaimedTaskResult(input, errorMessage) {
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
