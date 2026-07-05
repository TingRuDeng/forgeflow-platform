import path from "node:path";
import { bootstrapDispatcherBridge, createDispatcherClient, createStateDirDispatcherClient, } from "./worker-daemon-dispatcher-client.js";
import { buildClaimedTaskPayload, executeClaimedTask, submitFailedClaimedTaskResult, } from "./worker-daemon-task-executor.js";
export { createDispatcherClient, createStateDirDispatcherClient, };
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function resolveRepoRoot() {
    return path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
}
function buildClaimInput(input, client, payload) {
    return {
        client,
        repoRoot: input.repoRoot ?? resolveRepoRoot(),
        workerId: input.workerId,
        repoDir: input.repoDir,
        payload,
        dryRunExecution: Boolean(input.dryRunExecution),
        at: input.at,
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
                    return executeClaimedTask(buildClaimInput(input, client, claimedPayload));
                },
            },
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (claimedPayload && message.startsWith("submitResult failed after")) {
            await submitFailedClaimedTaskResult(buildClaimInput(input, client, claimedPayload), message);
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
