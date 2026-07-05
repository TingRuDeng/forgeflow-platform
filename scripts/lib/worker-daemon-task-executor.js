import path from "node:path";
import { importWorkerDaemonRuntime } from "./runtime-bootstrap.js";
import { buildFailedResultCallbacks, buildManagedTaskCallbacks, logCleanupError, reportWorkerEventBestEffort, } from "./worker-daemon-hooks.js";
import { buildWorkerProtocolEnvelope, } from "./worker-daemon-types.js";
async function bootstrapBetaRuntimeCore() {
    return importWorkerDaemonRuntime();
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
    const retryPolicy = betaRuntime.resolveManagedWorkerTaskRetryPolicy(process.env);
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
        ...retryPolicy,
        callbacks: buildManagedTaskCallbacks(input),
        failedResultCallbacks: buildFailedResultCallbacks(input, taskId),
    });
}
export async function submitFailedClaimedTaskResult(input, errorMessage) {
    const taskId = input.payload.task.id;
    const betaRuntime = await bootstrapBetaRuntimeCore();
    const retryPolicy = betaRuntime.resolveManagedWorkerTaskRetryPolicy(process.env);
    await betaRuntime.submitFailedWorkerResult({
        input,
        taskId,
        error: errorMessage,
        maxRetries: retryPolicy.maxFailedResultRetries,
        retryDelayMs: retryPolicy.failedResultRetryDelayMs,
        ...buildFailedResultCallbacks(input, taskId),
    });
}
