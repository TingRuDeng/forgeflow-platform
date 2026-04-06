import pino from "pino";

const LOG_LEVEL = process.env.LOG_LEVEL || "info";

export const logger = pino({
  level: LOG_LEVEL,
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  base: {
    service: "forgeflow",
  },
});

export const createChildLogger = (bindings: Record<string, unknown>) => {
  return logger.child(bindings);
};

export const logTaskAssigned = (
  taskId: string,
  workerId: string,
  repo: string
) => {
  logger.info({ taskId, workerId, repo, event: "task_assigned" });
};

export const logTaskCompleted = (
  taskId: string,
  workerId: string,
  durationMs: number,
  success: boolean
) => {
  logger.info({
    taskId,
    workerId,
    durationMs,
    success,
    event: "task_completed",
  });
};

export const logTaskFailed = (
  taskId: string,
  workerId: string,
  error: string
) => {
  logger.error({ taskId, workerId, error, event: "task_failed" });
};

export const logWorkerHeartbeat = (
  workerId: string,
  taskId: string | null
) => {
  logger.debug({ workerId, taskId, event: "worker_heartbeat" });
};

export const logDispatcherError = (
  operation: string,
  error: string,
  context?: Record<string, unknown>
) => {
  logger.error({ operation, error, ...context, event: "dispatcher_error" });
};

export const logGatewayRequest = (
  method: string,
  pathname: string,
  statusCode: number,
  durationMs: number
) => {
  logger.info({
    method,
    pathname,
    statusCode,
    durationMs,
    event: "gateway_request",
  });
};
