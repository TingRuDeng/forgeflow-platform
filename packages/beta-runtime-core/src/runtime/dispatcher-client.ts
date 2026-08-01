import {
  createAbortError,
  sleepUntilAborted,
  throwIfAborted,
} from "./abort-signal.js";
import type {
  DispatcherClient,
  TaskPayload,
} from "./types.js";

const HEARTBEAT_TIMEOUT_MS = 5_000;
const HEARTBEAT_MAX_RETRIES = 3;
const HEARTBEAT_RETRY_DELAY_MS = 1_000;

interface DispatcherCallInput {
  method: string;
  pathname: string;
  body?: unknown;
  timeout?: number;
  signal?: AbortSignal;
}

interface DispatcherRetryInput extends DispatcherCallInput {
  maxRetries?: number;
  retryDelayMs?: number;
}

function getDispatcherAuthHeader(): Record<string, string> {
  const token = process.env.DISPATCHER_WORKER_TOKEN || process.env.DISPATCHER_API_TOKEN;
  if (!token) {
    return {};
  }
  return { Authorization: `Bearer ${token}` };
}

export function createDispatcherClient(dispatcherUrl: string): DispatcherClient {
  const baseUrl = dispatcherUrl.replace(/\/$/, "");

  async function call(input: DispatcherCallInput): Promise<unknown> {
    const url = `${baseUrl}${input.pathname}`;
    throwIfAborted(input.signal, `dispatcher request aborted: ${input.method} ${url}`);
    const controller = new AbortController();
    const timeoutMs = input.timeout ?? 10_000;
    let timedOut = false;
    const onAbort = () => controller.abort(input.signal?.reason);
    input.signal?.addEventListener("abort", onAbort, { once: true });
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const response = await fetch(url, buildRequestInit(input.method, input.body, controller));
      return await parseDispatcherResponse(response, input.method, url);
    } catch (error) {
      if (input.signal?.aborted) {
        throw createAbortError(`dispatcher request aborted: ${input.method} ${url}`);
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (timedOut) {
        throw new Error(`dispatcher request failed: ${input.method} ${url} - timed out after ${timeoutMs}ms`);
      }
      throw new Error(`dispatcher request failed: ${input.method} ${url} - ${errorMessage}`);
    } finally {
      clearTimeout(timeoutId);
      input.signal?.removeEventListener("abort", onAbort);
    }
  }

  async function callWithRetry(input: DispatcherRetryInput): Promise<unknown> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= (input.maxRetries ?? 0); attempt++) {
      throwIfAborted(input.signal, `dispatcher request aborted: ${input.method} ${baseUrl}${input.pathname}`);
      try {
        return await call(input);
      } catch (error) {
        if (input.signal?.aborted) {
          throw createAbortError(`dispatcher request aborted: ${input.method} ${baseUrl}${input.pathname}`);
        }
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < (input.maxRetries ?? 0)) {
          await sleepUntilAborted(
            input.retryDelayMs ?? 1_000,
            input.signal,
            "dispatcher retry aborted",
          );
        }
      }
    }
    throw lastError;
  }

  return buildDispatcherClient(call, callWithRetry);
}

function buildRequestInit(method: string, body: unknown, controller: AbortController): RequestInit {
  return {
    method,
    headers: {
      "content-type": "application/json",
      ...getDispatcherAuthHeader(),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: controller.signal,
  };
}

async function parseDispatcherResponse(response: Response, method: string, url: string): Promise<unknown> {
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error((json as { error?: string }).error || text || `dispatcher request failed: ${method} ${url} -> ${response.status}`);
  }
  return json;
}

function buildDispatcherClient(
  call: (input: DispatcherCallInput) => Promise<unknown>,
  callWithRetry: (input: DispatcherRetryInput) => Promise<unknown>
): DispatcherClient {
  return {
    registerWorker: (worker, options) => call({
      method: "POST",
      pathname: "/api/workers/register",
      body: worker,
      signal: options?.signal,
    }),
    heartbeat: (workerId, payload, options) => callWithRetry({
      method: "POST",
      pathname: `/api/workers/${encodeURIComponent(workerId)}/heartbeat`,
      body: payload,
      timeout: HEARTBEAT_TIMEOUT_MS,
      maxRetries: HEARTBEAT_MAX_RETRIES,
      retryDelayMs: HEARTBEAT_RETRY_DELAY_MS,
      signal: options?.signal,
    }),
    getAssignedTask: (workerId, options) => call({
      method: "GET",
      pathname: `/api/workers/${encodeURIComponent(workerId)}/assigned-task`,
      signal: options?.signal,
    }) as Promise<TaskPayload | null>,
    claimTask: (workerId, payload = {}, options) => call({
      method: "POST",
      pathname: `/api/workers/${encodeURIComponent(workerId)}/claim-task`,
      body: payload,
      signal: options?.signal,
    }) as Promise<TaskPayload | null>,
    startTask: (workerId, payload, options) => call({
      method: "POST",
      pathname: `/api/workers/${encodeURIComponent(workerId)}/start-task`,
      body: payload,
      signal: options?.signal,
    }),
    reportProgress: (workerId, payload, options) => call({
      method: "POST",
      pathname: `/api/workers/${encodeURIComponent(workerId)}/progress`,
      body: payload,
      signal: options?.signal,
    }),
    submitResult: (workerId, payload, options) => call({
      method: "POST",
      pathname: `/api/workers/${encodeURIComponent(workerId)}/result`,
      body: payload,
      signal: options?.signal,
    }),
  };
}
