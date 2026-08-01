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
                    receivedAt: new Date().toISOString(),
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
        async registerWorker(worker, options) {
            return (await resolveClient()).registerWorker(worker, options);
        },
        async heartbeat(workerId, payload, options) {
            return (await resolveClient()).heartbeat(workerId, payload, options);
        },
        async getAssignedTask(workerId, options) {
            return (await resolveClient()).getAssignedTask(workerId, options);
        },
        async claimTask(workerId, payload = {}, options) {
            return (await resolveClient()).claimTask(workerId, payload, options);
        },
        async startTask(workerId, payload, options) {
            return (await resolveClient()).startTask(workerId, payload, options);
        },
        async reportProgress(workerId, payload, options) {
            return (await resolveClient()).reportProgress(workerId, payload, options);
        },
        async submitResult(workerId, payload, options) {
            return (await resolveClient()).submitResult(workerId, payload, options);
        },
        async reportEvent(workerId, payload, options) {
            return (await resolveClient()).reportEvent?.(workerId, payload, options);
        },
    };
}
