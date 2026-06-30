import pino from "pino";
const LOG_LEVEL = process.env.LOG_LEVEL || "info";
export const logger = pino({
    level: LOG_LEVEL,
    redact: {
        paths: [
            "authorization",
            "authHeader",
            "headers.authorization",
            "req.headers.authorization",
            "*.authorization",
            "*.authHeader",
            "*.token",
            "*.apiToken",
            "*.DISPATCHER_API_TOKEN",
            "*.GITHUB_TOKEN",
        ],
        censor: "[REDACTED]",
    },
    formatters: {
        level: (label) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    base: {
        service: "forgeflow",
    },
});
export const createChildLogger = (bindings) => {
    return logger.child(bindings);
};
export const logTaskAssigned = (taskId, workerId, repo) => {
    logger.info({ taskId, workerId, repo, event: "task_assigned" });
};
export const logTaskCompleted = (taskId, workerId, durationMs, success) => {
    logger.info({
        taskId,
        workerId,
        durationMs,
        success,
        event: "task_completed",
    });
};
export const logTaskFailed = (taskId, workerId, error) => {
    logger.error({ taskId, workerId, error, event: "task_failed" });
};
export const logWorkerHeartbeat = (workerId, taskId) => {
    logger.debug({ workerId, taskId, event: "worker_heartbeat" });
};
export const logDispatcherError = (operation, error, context) => {
    logger.error({ operation, error, ...context, event: "dispatcher_error" });
};
export const logGatewayRequest = (method, pathname, statusCode, durationMs) => {
    logger.info({
        method,
        pathname,
        statusCode,
        durationMs,
        event: "gateway_request",
    });
};
