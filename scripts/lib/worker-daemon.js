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
        signal: input.signal,
    };
}
export async function runWorkerDaemonCycle(input) {
    if (input.signal?.aborted) {
        return { status: "stopped", workerId: input.workerId };
    }
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
            signal: input.signal,
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
            try {
                await submitFailedClaimedTaskResult(buildClaimInput(input, client, claimedPayload), message);
            }
            catch (fallbackError) {
                if (error instanceof Error && error.cause === undefined) {
                    error.cause = fallbackError;
                }
            }
        }
        throw error;
    }
}
export async function runWorkerDaemon(input) {
    while (!input.signal?.aborted) {
        let summary;
        try {
            summary = await runWorkerDaemonCycle(input);
        }
        catch (error) {
            if (input.signal?.aborted) {
                return { status: "stopped", workerId: input.workerId };
            }
            throw error;
        }
        if (input.once) {
            return summary;
        }
        await sleepUntilAborted(input.pollIntervalMs ?? 5000, input.signal);
    }
    return { status: "stopped", workerId: input.workerId };
}
function sleepUntilAborted(ms, signal) {
    if (!signal) {
        return sleep(ms);
    }
    if (signal.aborted) {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        const timer = setTimeout(finish, ms);
        function finish() {
            clearTimeout(timer);
            signal?.removeEventListener("abort", finish);
            resolve();
        }
        signal.addEventListener("abort", finish, { once: true });
    });
}
