import {
  sleepUntilAborted,
  throwIfAborted,
} from "./abort-signal.js";

export interface DispatcherRetryPolicy {
  maxAttempts: number;
  retryDelayMs: number;
}

export interface RetryDispatcherRequestInput<T> extends DispatcherRetryPolicy {
  operation: string;
  send: (attempt: number) => Promise<T>;
  signal?: AbortSignal;
  shouldRetry?: (error: unknown) => boolean;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export class DispatcherHttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "DispatcherHttpError";
    this.status = status;
  }
}

export class DispatcherTransportError extends Error {
  readonly retryable = true;

  constructor(message: string) {
    super(message);
    this.name = "DispatcherTransportError";
  }
}

export class DispatcherResponseError extends Error {
  readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = "DispatcherResponseError";
  }
}

export function readDispatcherHttpErrorMessage(
  body: unknown,
  rawText: string,
  fallback: string,
): string {
  if (body && typeof body === "object") {
    for (const key of ["message", "error"] as const) {
      const value = (body as Record<string, unknown>)[key];
      if (typeof value === "string" && value.trim()) {
        return value;
      }
    }
  }
  if (body === null && rawText.trim() === "null") {
    return fallback;
  }
  return rawText || fallback;
}

export function snapshotDispatcherPayload<T>(payload: T): T {
  return JSON.parse(JSON.stringify(payload)) as T;
}

export function getDispatcherHttpStatus(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("status" in error)) {
    return null;
  }
  const status = Number((error as { status?: unknown }).status);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
}

export function isRetryableDispatcherRequestError(error: unknown): boolean {
  if (error instanceof Error && error.name === "AbortError") {
    return false;
  }
  if (error && typeof error === "object" && "retryable" in error) {
    const retryable = (error as { retryable?: unknown }).retryable;
    if (typeof retryable === "boolean") {
      return retryable;
    }
  }
  const status = getDispatcherHttpStatus(error);
  if (status === null) {
    return false;
  }
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export async function retryDispatcherRequest<T>(
  input: RetryDispatcherRequestInput<T>,
): Promise<T> {
  const operation = input.operation.trim() || "dispatcher request";
  if (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1) {
    throw new RangeError(`${operation} maxAttempts must be a positive integer`);
  }
  if (!Number.isInteger(input.retryDelayMs) || input.retryDelayMs < 0) {
    throw new RangeError(`${operation} retryDelayMs must be a non-negative integer`);
  }
  const shouldRetry = input.shouldRetry ?? isRetryableDispatcherRequestError;
  const sleep = input.sleep ?? ((ms, signal) => sleepUntilAborted(
    ms,
    signal,
    `${operation} retry aborted`,
  ));

  for (let attempt = 1; attempt <= input.maxAttempts; attempt += 1) {
    throwIfAborted(input.signal, `${operation} aborted`);
    try {
      const result = await input.send(attempt);
      throwIfAborted(input.signal, `${operation} aborted`);
      return result;
    } catch (error) {
      if (input.signal?.aborted) {
        throwIfAborted(input.signal, `${operation} aborted`);
      }
      if (attempt >= input.maxAttempts || !shouldRetry(error)) {
        throw error;
      }
      await sleep(input.retryDelayMs, input.signal);
    }
  }

  throw new Error(`${operation} exhausted without a result`);
}
