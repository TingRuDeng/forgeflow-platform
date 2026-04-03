// @ts-nocheck
export class TraeAutomationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "TraeAutomationError";
    this.code = code;
    this.details = details;
  }
}

export function normalizeAutomationError(
  error,
  fallbackCode = "AUTOMATION_ERROR",
  fallbackMessage = "Trae automation failed"
) {
  if (error instanceof TraeAutomationError) {
    return error;
  }

  const normalized = new TraeAutomationError(
    error?.code || fallbackCode,
    error?.message || fallbackMessage,
    error?.details || {}
  );

  if (error?.stack) {
    normalized.stack = error.stack;
  }

  return normalized;
}
