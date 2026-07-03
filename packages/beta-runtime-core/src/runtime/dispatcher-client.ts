import { sleep } from "./utils.js";
import type { DispatcherClient, TaskPayload } from "./types.js";

const HEARTBEAT_TIMEOUT_MS = 5_000;
const HEARTBEAT_MAX_RETRIES = 3;
const HEARTBEAT_RETRY_DELAY_MS = 1_000;

interface DispatcherCallInput {
  method: string;
  pathname: string;
  body?: unknown;
  timeout?: number;
}

interface DispatcherRetryInput extends DispatcherCallInput {
  maxRetries?: number;
  retryDelayMs?: number;
}

function getDispatcherAuthHeader(): Record<string, string> {
  const token = process.env.DISPATCHER_API_TOKEN;
  if (!token) {
    return {};
  }
  return { Authorization: `Bearer ${token}` };
}

export function createDispatcherClient(dispatcherUrl: string): DispatcherClient {
  const baseUrl = dispatcherUrl.replace(/\/$/, "");

  async function call(input: DispatcherCallInput): Promise<unknown> {
    const url = `${baseUrl}${input.pathname}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), input.timeout ?? 10_000);
    try {
      const response = await fetch(url, buildRequestInit(input.method, input.body, controller));
      clearTimeout(timeoutId);
      return await parseDispatcherResponse(response, input.method, url);
    } catch (error) {
      clearTimeout(timeoutId);
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`dispatcher request failed: ${input.method} ${url} - ${errorMessage}`);
    }
  }

  async function callWithRetry(input: DispatcherRetryInput): Promise<unknown> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= (input.maxRetries ?? 0); attempt++) {
      try {
        return await call(input);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < (input.maxRetries ?? 0)) {
          await sleep(input.retryDelayMs ?? 1_000);
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
    registerWorker: (worker) => call({ method: "POST", pathname: "/api/workers/register", body: worker }),
    heartbeat: (workerId, payload) => callWithRetry({
      method: "POST",
      pathname: `/api/workers/${encodeURIComponent(workerId)}/heartbeat`,
      body: payload,
      timeout: HEARTBEAT_TIMEOUT_MS,
      maxRetries: HEARTBEAT_MAX_RETRIES,
      retryDelayMs: HEARTBEAT_RETRY_DELAY_MS,
    }),
    getAssignedTask: (workerId) => call({ method: "GET", pathname: `/api/workers/${encodeURIComponent(workerId)}/assigned-task` }) as Promise<TaskPayload | null>,
    claimTask: (workerId, payload = {}) => call({ method: "POST", pathname: `/api/workers/${encodeURIComponent(workerId)}/claim-task`, body: payload }) as Promise<TaskPayload | null>,
    startTask: (workerId, payload) => call({ method: "POST", pathname: `/api/workers/${encodeURIComponent(workerId)}/start-task`, body: payload }),
    submitResult: (workerId, payload) => call({ method: "POST", pathname: `/api/workers/${encodeURIComponent(workerId)}/result`, body: payload }),
  };
}
