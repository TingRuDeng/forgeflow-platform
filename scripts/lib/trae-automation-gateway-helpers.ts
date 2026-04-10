export class ApiError extends Error {
  code: string;
  statusCode: number;
  details: Record<string, unknown>;

  constructor(code: string, message: string, statusCode: number, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function normalizeApiError(error: unknown): ApiError {
  return error instanceof ApiError
    ? error
    : new ApiError(
      (error as { code?: string })?.code || "INTERNAL_ERROR",
      (error as Error)?.message || "Internal server error",
      500,
      (error as { details?: Record<string, unknown> })?.details || {},
    );
}

export function isTimeoutError(error: unknown): boolean {
  if (!error) {
    return false;
  }

  if ((error as { code?: string }).code === "AUTOMATION_RESPONSE_TIMEOUT") {
    return true;
  }

  const message = error instanceof Error ? error.message : String((error as { message?: string })?.message || "");
  return /request timeout/i.test(message)
    || /timed out waiting for trae to finish responding/i.test(message);
}

export function parseDiscoveryFromQuery(query: Record<string, string> = {}): Record<string, unknown> | null {
  const titleContains = String(query.title_contains || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const urlContains = String(query.url_contains || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const discovery: Record<string, unknown> = {};
  if (titleContains.length > 0) {
    discovery.titleContains = titleContains;
  }
  if (urlContains.length > 0) {
    discovery.urlContains = urlContains;
  }
  return Object.keys(discovery).length > 0 ? discovery : null;
}
