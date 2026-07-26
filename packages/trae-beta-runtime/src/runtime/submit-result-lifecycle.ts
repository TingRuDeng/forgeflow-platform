const DEFAULT_SUBMIT_RESULT_MAX_ATTEMPTS = 3;
const DEFAULT_SUBMIT_RESULT_RETRY_DELAY_MS = 2_000;

export interface SubmitResultLifecycleInput<Request> {
  taskId: string;
  sessionId: string | null;
  status: string;
  startPayload: Record<string, unknown>;
  startDebug: Record<string, unknown>;
  request: Request;
  donePayload: Record<string, unknown>;
  emitPhaseEvent: (type: string, payload: Record<string, unknown>, taskId: string) => Promise<void>;
  debugLog: (event: string, payload: Record<string, unknown>) => void;
  submitResult: (request: Request, options?: { signal?: AbortSignal }) => Promise<unknown>;
  promoteToIdle: () => void;
  releaseSession: (sessionId: string | null) => Promise<void>;
  signal?: AbortSignal;
  maxAttempts?: number;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class WorkerResultDeliveryError extends Error {
  readonly attempts: number;
  readonly lastError: unknown;

  constructor(attempts: number, lastError: unknown) {
    const message = lastError instanceof Error ? lastError.message : String(lastError);
    super(`submitResult failed after ${attempts} attempts: ${message}`);
    this.name = "WorkerResultDeliveryError";
    this.attempts = attempts;
    this.lastError = lastError;
  }
}

function resolvePositiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveNonNegativeInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function createAbortError(): Error {
  const error = new Error("Trae worker result delivery aborted");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

async function sleepUntilAborted(
  ms: number,
  signal: AbortSignal | undefined,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  throwIfAborted(signal);
  if (!signal) {
    await sleep(ms);
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (operation: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      operation();
    };
    const onAbort = () => finish(() => reject(createAbortError()));
    signal.addEventListener("abort", onAbort, { once: true });
    void sleep(ms).then(
      () => finish(resolve),
      (error) => finish(() => reject(error)),
    );
  });
}

async function emitBestEffort<Request>(
  input: SubmitResultLifecycleInput<Request>,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await input.emitPhaseEvent(type, payload, input.taskId);
  } catch {
    // Diagnostic delivery must not replace the terminal result delivery error.
  }
}

export async function submitResultLifecycle<Request>(input: SubmitResultLifecycleInput<Request>): Promise<void> {
  await input.emitPhaseEvent("submit_result_start", input.startPayload, input.taskId);
  input.debugLog("dispatcher.submit_result.start", input.startDebug);
  const maxAttempts = resolvePositiveInteger(
    input.maxAttempts ?? process.env.WORKER_DAEMON_SUBMIT_RESULT_MAX_RETRIES,
    DEFAULT_SUBMIT_RESULT_MAX_ATTEMPTS,
  );
  const retryDelayMs = resolveNonNegativeInteger(
    input.retryDelayMs ?? process.env.WORKER_DAEMON_SUBMIT_RESULT_RETRY_DELAY_MS,
    DEFAULT_SUBMIT_RESULT_RETRY_DELAY_MS,
  );
  const sleep = input.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  let acknowledged = false;
  let lastError: unknown = null;

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      throwIfAborted(input.signal);
      try {
        if (input.signal) {
          await input.submitResult(input.request, { signal: input.signal });
        } else {
          await input.submitResult(input.request);
        }
        acknowledged = true;
        break;
      } catch (error) {
        throwIfAborted(input.signal);
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        await emitBestEffort(input, "submit_result_retry_failed", {
          attempt,
          maxAttempts,
          error: message,
        });
        input.debugLog("dispatcher.submit_result.retry_failed", {
          taskId: input.taskId,
          status: input.status,
          attempt,
          maxAttempts,
          error: message,
        });
        if (attempt < maxAttempts) {
          await sleepUntilAborted(retryDelayMs, input.signal, sleep);
        }
      }
    }

    if (!acknowledged) {
      const message = lastError instanceof Error ? lastError.message : String(lastError);
      await emitBestEffort(input, "delivery_failed", {
        stage: "submit_result",
        error: message,
        failureCode: "delivery_failed",
        attempts: maxAttempts,
      });
      input.debugLog("dispatcher.submit_result.delivery_failed", {
        taskId: input.taskId,
        status: input.status,
        attempts: maxAttempts,
        error: message,
      });
      throw new WorkerResultDeliveryError(maxAttempts, lastError);
    }

    await emitBestEffort(input, "submit_result_done", input.donePayload);
    input.debugLog("dispatcher.submit_result.done", { taskId: input.taskId, status: input.status });
  } finally {
    if (acknowledged) {
      try {
        input.promoteToIdle();
      } finally {
        await input.releaseSession(input.sessionId);
      }
    }
  }
}
