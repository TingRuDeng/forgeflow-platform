export function buildWorkerProtocolEnvelope(payload) {
    return {
        attemptId: payload.attemptId,
        leaseToken: payload.leaseToken,
        protocolVersion: payload.protocolVersion,
        traceId: payload.traceId,
        idempotencyKey: payload.idempotencyKey,
    };
}
