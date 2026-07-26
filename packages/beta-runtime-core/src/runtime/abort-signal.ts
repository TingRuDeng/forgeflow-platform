import { sleep } from "./utils.js";
import type { DispatcherRequestOptions } from "./types.js";

export function createAbortError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

export function throwIfAborted(
  signal: AbortSignal | undefined,
  message: string,
): void {
  if (signal?.aborted) {
    throw createAbortError(message);
  }
}

export function sleepUntilAborted(
  ms: number,
  signal: AbortSignal | undefined,
  message: string,
): Promise<void> {
  if (!signal) {
    return sleep(ms);
  }
  throwIfAborted(signal, message);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, ms);
    function finish() {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }
    function onAbort() {
      clearTimeout(timer);
      reject(createAbortError(message));
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function requestOptions(
  signal?: AbortSignal,
): [] | [DispatcherRequestOptions] {
  return signal ? [{ signal }] : [];
}
