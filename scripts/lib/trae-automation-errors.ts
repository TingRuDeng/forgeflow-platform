export class TraeAutomationError extends Error {
  code: string;
  details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "TraeAutomationError";
    this.code = code;
    this.details = details;
  }
}

export function normalizeAutomationError(
  error: unknown,
  fallbackCode = "AUTOMATION_ERROR",
  fallbackMessage = "Trae automation failed"
): TraeAutomationError {
  if (error instanceof TraeAutomationError) {
    return error;
  }

  const err = error as Record<string, unknown> | null | undefined;
  const normalized = new TraeAutomationError(
    String(err?.code || fallbackCode),
    String(err?.message || fallbackMessage),
    (err?.details as Record<string, unknown>) || {}
  );

  if (err?.stack && typeof err.stack === "string") {
    normalized.stack = err.stack;
  }

  return normalized;
}
