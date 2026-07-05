export interface AutomationGatewayDebugLogger {
  log?: (message?: unknown, ...optionalParams: unknown[]) => void;
  warn?: (message?: unknown, ...optionalParams: unknown[]) => void;
}

export interface AutomationGatewayDebugLoggerOptions {
  now?: () => string;
  prefix?: string;
}

export function isAutomationGatewayDebugEnabled(value: unknown): boolean {
  if (value === true) {
    return true;
  }

  const envValue = String(process.env.TRAE_AUTOMATION_DEBUG || "").trim().toLowerCase();
  return envValue === "1" || envValue === "true";
}

export function createAutomationGatewayDebugLogger(
  enabled: boolean,
  logger: AutomationGatewayDebugLogger = console,
  options: AutomationGatewayDebugLoggerOptions = {},
): (event: string, details?: Record<string, unknown>) => void {
  const now = options.now || (() => new Date().toISOString());
  const prefix = options.prefix || "[trae-gateway][debug]";

  return (event: string, details: Record<string, unknown> = {}) => {
    if (!enabled) {
      return;
    }

    const payload = {
      at: now(),
      event,
      ...details,
    };

    try {
      logger.log?.(`${prefix} ${JSON.stringify(payload)}`);
    } catch {
      logger.log?.(`${prefix} ${event}`);
    }
  };
}
