import type {
  DispatcherWorkerClient,
  WorkerRegistration,
  HeartbeatPayload,
  StartTaskPayload,
  ProgressTaskPayload,
  SubmitResultPayload,
  AssignedTaskResponse,
  DispatcherRequestOptions,
} from "./runtime-glue-types.js";

const HEARTBEAT_TIMEOUT_MS = 5_000;
const HEARTBEAT_MAX_RETRIES = 3;
const HEARTBEAT_RETRY_DELAY_MS = 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createAbortError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined, message: string): void {
  if (signal?.aborted) {
    throw createAbortError(message);
  }
}

function sleepUntilAborted(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return sleep(ms);
  }
  throwIfAborted(signal, "dispatcher retry aborted");
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, ms);
    function finish() {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }
    function onAbort() {
      clearTimeout(timer);
      reject(createAbortError("dispatcher retry aborted"));
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export interface DispatcherHttpClient extends DispatcherWorkerClient {
  registerWorker(worker: WorkerRegistration, options?: DispatcherRequestOptions): Promise<unknown>;
  heartbeat(workerId: string, payload: HeartbeatPayload, options?: DispatcherRequestOptions): Promise<unknown>;
  getAssignedTask(workerId: string, options?: DispatcherRequestOptions): Promise<AssignedTaskResponse>;
  claimTask(workerId: string, payload?: { at?: string }, options?: DispatcherRequestOptions): Promise<AssignedTaskResponse>;
  startTask(workerId: string, payload: StartTaskPayload, options?: DispatcherRequestOptions): Promise<unknown>;
  reportProgress(workerId: string, payload: ProgressTaskPayload, options?: DispatcherRequestOptions): Promise<unknown>;
  submitResult(workerId: string, payload: SubmitResultPayload, options?: DispatcherRequestOptions): Promise<unknown>;
}

export interface DispatcherStateDirClient {
  registerWorker(worker: WorkerRegistration, options?: DispatcherRequestOptions): Promise<unknown>;
  heartbeat(workerId: string, payload: HeartbeatPayload, options?: DispatcherRequestOptions): Promise<unknown>;
  getAssignedTask(workerId: string, options?: DispatcherRequestOptions): Promise<unknown>;
  claimTask(workerId: string, payload?: { at?: string }, options?: DispatcherRequestOptions): Promise<unknown>;
  startTask(workerId: string, payload: StartTaskPayload, options?: DispatcherRequestOptions): Promise<unknown>;
  reportProgress(workerId: string, payload: ProgressTaskPayload, options?: DispatcherRequestOptions): Promise<unknown>;
  submitResult(workerId: string, payload: SubmitResultPayload, options?: DispatcherRequestOptions): Promise<unknown>;
  reportEvent(workerId: string, payload: { type: string; taskId?: string; payload?: unknown; at?: string }, options?: DispatcherRequestOptions): Promise<unknown>;
}

export interface CreateDispatcherHttpClientOptions {
  dispatcherUrl: string;
  fetchImpl?: typeof globalThis.fetch;
  requestTimeoutMs?: number;
}

export function createDispatcherHttpClient(
  options: CreateDispatcherHttpClientOptions,
): DispatcherHttpClient {
  const baseUrl = options.dispatcherUrl.replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const defaultTimeout = options.requestTimeoutMs ?? 10_000;

  async function call(
    method: string,
    pathname: string,
    body: unknown,
    callOptions: { timeout?: number; signal?: AbortSignal } = {},
  ): Promise<unknown> {
    const url = `${baseUrl}${pathname}`;
    throwIfAborted(callOptions.signal, `dispatcher request aborted: ${method} ${url}`);
    const timeoutMs = callOptions.timeout ?? defaultTimeout;
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => controller.abort(callOptions.signal?.reason);
    callOptions.signal?.addEventListener("abort", onAbort, { once: true });
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetchImpl(url, {
        method,
        headers: {
          "content-type": "application/json",
          ...getDispatcherAuthHeader(),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await response.text();
      const json = text ? JSON.parse(text) : {};
      if (!response.ok) {
        throw new Error(
          json.error || text || `dispatcher request failed: ${method} ${url} -> ${response.status}`,
        );
      }
      return json;
    } catch (error) {
      if (callOptions.signal?.aborted) {
        throw createAbortError(`dispatcher request aborted: ${method} ${url}`);
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (timedOut) {
        throw new Error(`dispatcher request failed: ${method} ${url} - timed out after ${timeoutMs}ms`);
      }
      throw new Error(`dispatcher request failed: ${method} ${url} - ${errorMessage}`);
    } finally {
      clearTimeout(timeoutId);
      callOptions.signal?.removeEventListener("abort", onAbort);
    }
  }

  async function callWithRetry(
    method: string,
    pathname: string,
    body: unknown,
    callOptions: {
      timeout?: number;
      maxRetries?: number;
      retryDelayMs?: number;
      signal?: AbortSignal;
    } = {},
  ): Promise<unknown> {
    const maxRetries = callOptions.maxRetries ?? 0;
    const retryDelayMs = callOptions.retryDelayMs ?? 1_000;
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      throwIfAborted(callOptions.signal, `dispatcher request aborted: ${method} ${baseUrl}${pathname}`);
      try {
        return await call(method, pathname, body, {
          timeout: callOptions.timeout,
          signal: callOptions.signal,
        });
      } catch (error) {
        if (callOptions.signal?.aborted) {
          throw createAbortError(`dispatcher request aborted: ${method} ${baseUrl}${pathname}`);
        }
        lastError = error;
        if (attempt < maxRetries) {
          await sleepUntilAborted(retryDelayMs, callOptions.signal);
        }
      }
    }
    throw lastError;
  }

  return {
    registerWorker(worker: WorkerRegistration, requestOptions?: DispatcherRequestOptions): Promise<unknown> {
      return call("POST", "/api/workers/register", worker, {
        signal: requestOptions?.signal,
      }) as Promise<unknown>;
    },

    heartbeat(workerId: string, payload: HeartbeatPayload, requestOptions?: DispatcherRequestOptions): Promise<unknown> {
      return callWithRetry(
        "POST",
        `/api/workers/${encodeURIComponent(workerId)}/heartbeat`,
        payload,
        {
          timeout: HEARTBEAT_TIMEOUT_MS,
          maxRetries: HEARTBEAT_MAX_RETRIES,
          retryDelayMs: HEARTBEAT_RETRY_DELAY_MS,
          signal: requestOptions?.signal,
        },
      ) as Promise<unknown>;
    },

    getAssignedTask(workerId: string, requestOptions?: DispatcherRequestOptions): Promise<AssignedTaskResponse> {
      return call(
        "GET",
        `/api/workers/${encodeURIComponent(workerId)}/assigned-task`,
        undefined,
        { signal: requestOptions?.signal },
      ) as Promise<AssignedTaskResponse>;
    },

    claimTask(workerId: string, payload?: { at?: string }, requestOptions?: DispatcherRequestOptions): Promise<AssignedTaskResponse> {
      return call(
        "POST",
        `/api/workers/${encodeURIComponent(workerId)}/claim-task`,
        payload ?? {},
        { signal: requestOptions?.signal },
      ) as Promise<AssignedTaskResponse>;
    },

    startTask(workerId: string, payload: StartTaskPayload, requestOptions?: DispatcherRequestOptions): Promise<unknown> {
      return call(
        "POST",
        `/api/workers/${encodeURIComponent(workerId)}/start-task`,
        payload,
        { signal: requestOptions?.signal },
      ) as Promise<unknown>;
    },

    reportProgress(workerId: string, payload: ProgressTaskPayload, requestOptions?: DispatcherRequestOptions): Promise<unknown> {
      return call(
        "POST",
        `/api/workers/${encodeURIComponent(workerId)}/progress`,
        payload,
        { signal: requestOptions?.signal },
      ) as Promise<unknown>;
    },

    submitResult(workerId: string, payload: SubmitResultPayload, requestOptions?: DispatcherRequestOptions): Promise<unknown> {
      return call(
        "POST",
        `/api/workers/${encodeURIComponent(workerId)}/result`,
        payload,
        { signal: requestOptions?.signal },
      ) as Promise<unknown>;
    },

    reportEvent(workerId: string, payload: { type: string; taskId?: string; payload?: unknown; at?: string }, requestOptions?: DispatcherRequestOptions): Promise<unknown> {
      return call(
        "POST",
        `/api/workers/${encodeURIComponent(workerId)}/events`,
        payload,
        { signal: requestOptions?.signal },
      ) as Promise<unknown>;
    },
  };
}

export interface CreateDispatcherStateDirClientOptions {
  handleRequest: (input: {
    stateDir: string;
    method: string;
    pathname: string;
    body?: unknown;
    internalCall?: boolean;
  }) => { status?: number; json: unknown } | Promise<{ status?: number; json: unknown }>;
}

export function createDispatcherStateDirClientFactory(
  options: CreateDispatcherStateDirClientOptions,
): (stateDir: string) => DispatcherStateDirClient {
  const { handleRequest } = options;

  return (stateDir: string): DispatcherStateDirClient => {
    return {
      async registerWorker(worker: WorkerRegistration, requestOptions?: DispatcherRequestOptions): Promise<unknown> {
        throwIfAborted(requestOptions?.signal, "dispatcher state-dir request aborted");
        return readStateDirResponseJson(await handleRequest({
          stateDir,
          method: "POST",
          pathname: "/api/workers/register",
          body: worker,
          internalCall: true,
        }));
      },

      async heartbeat(workerId: string, payload: HeartbeatPayload, requestOptions?: DispatcherRequestOptions): Promise<unknown> {
        throwIfAborted(requestOptions?.signal, "dispatcher state-dir request aborted");
        return readStateDirResponseJson(await handleRequest({
          stateDir,
          method: "POST",
          pathname: `/api/workers/${encodeURIComponent(workerId)}/heartbeat`,
          body: payload,
          internalCall: true,
        }));
      },

      async getAssignedTask(workerId: string, requestOptions?: DispatcherRequestOptions): Promise<unknown> {
        throwIfAborted(requestOptions?.signal, "dispatcher state-dir request aborted");
        return readStateDirResponseJson(await handleRequest({
          stateDir,
          method: "GET",
          pathname: `/api/workers/${encodeURIComponent(workerId)}/assigned-task`,
          internalCall: true,
        }));
      },

      async claimTask(workerId: string, payload?: { at?: string }, requestOptions?: DispatcherRequestOptions): Promise<unknown> {
        throwIfAborted(requestOptions?.signal, "dispatcher state-dir request aborted");
        return readStateDirResponseJson(await handleRequest({
          stateDir,
          method: "POST",
          pathname: `/api/workers/${encodeURIComponent(workerId)}/claim-task`,
          body: payload ?? {},
          internalCall: true,
        }));
      },

      async startTask(workerId: string, payload: StartTaskPayload, requestOptions?: DispatcherRequestOptions): Promise<unknown> {
        throwIfAborted(requestOptions?.signal, "dispatcher state-dir request aborted");
        return readStateDirResponseJson(await handleRequest({
          stateDir,
          method: "POST",
          pathname: `/api/workers/${encodeURIComponent(workerId)}/start-task`,
          body: payload,
          internalCall: true,
        }));
      },

      async reportProgress(workerId: string, payload: ProgressTaskPayload, requestOptions?: DispatcherRequestOptions): Promise<unknown> {
        throwIfAborted(requestOptions?.signal, "dispatcher state-dir request aborted");
        return readStateDirResponseJson(await handleRequest({
          stateDir,
          method: "POST",
          pathname: `/api/workers/${encodeURIComponent(workerId)}/progress`,
          body: payload,
          internalCall: true,
        }));
      },

      async submitResult(workerId: string, payload: SubmitResultPayload, requestOptions?: DispatcherRequestOptions): Promise<unknown> {
        throwIfAborted(requestOptions?.signal, "dispatcher state-dir request aborted");
        return readStateDirResponseJson(await handleRequest({
          stateDir,
          method: "POST",
          pathname: `/api/workers/${encodeURIComponent(workerId)}/result`,
          body: payload,
          internalCall: true,
        }));
      },

      async reportEvent(workerId: string, payload: { type: string; taskId?: string; payload?: unknown; at?: string }, requestOptions?: DispatcherRequestOptions): Promise<unknown> {
        throwIfAborted(requestOptions?.signal, "dispatcher state-dir request aborted");
        return readStateDirResponseJson(await handleRequest({
          stateDir,
          method: "POST",
          pathname: `/api/workers/${encodeURIComponent(workerId)}/events`,
          body: payload,
          internalCall: true,
        }));
      },
    };
  };
}

function getDispatcherAuthHeader(): Record<string, string> {
  const token = process.env.DISPATCHER_WORKER_TOKEN || process.env.DISPATCHER_API_TOKEN;
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

function readStateDirResponseJson(response: { status?: number; json: unknown }): unknown {
  if (response.status !== undefined && response.status >= 400) {
    const error = response.json && typeof response.json === "object" && "error" in response.json
      ? String((response.json as { error?: unknown }).error)
      : `dispatcher state-dir request failed: ${response.status}`;
    throw new Error(error);
  }
  return response.json;
}

export {
  runWorkerDaemon,
  runWorkerDaemonCycle,
} from "./runtime-glue-worker-daemon-cycle.js";

export type {
  CreateWorkerDaemonCycleOptions,
  RunWorkerDaemonOptions,
  TaskExecutionResult,
  TaskExecutor,
  WorkerDaemonCycleResult,
} from "./runtime-glue-worker-daemon-cycle.js";
