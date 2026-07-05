import { handleDispatcherHttpRequest } from "./dispatcher-server.js";
import { importDispatcherRuntimeBridge } from "./runtime-bootstrap.js";
export async function bootstrapDispatcherBridge() {
    return importDispatcherRuntimeBridge();
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
