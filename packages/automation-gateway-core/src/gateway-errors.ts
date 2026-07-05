import { isRecord } from "./gateway-utils.js";

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
  if (error instanceof ApiError) {
    return error;
  }
  const record = isRecord(error) ? error : {};
  return new ApiError(
    typeof record.code === "string" ? record.code : "INTERNAL_ERROR",
    error instanceof Error ? error.message : "Internal server error",
    500,
    isRecord(record.details) ? record.details : {},
  );
}
