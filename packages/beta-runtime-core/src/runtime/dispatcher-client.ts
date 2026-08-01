import {
  createAbortError,
  throwIfAborted,
} from "./abort-signal.js";
import {
  DispatcherHttpError,
  DispatcherResponseError,
  DispatcherTransportError,
  readDispatcherHttpErrorMessage,
} from "./dispatcher-request-retry.js";
import { getDispatcherAuthHeader } from "./dispatcher-auth.js";
import {
  retryHeartbeatDelivery,
  snapshotHeartbeatPayload,
} from "./heartbeat-delivery.js";
import {
  resolveProgressDeliveryPolicy,
  retryProgressDelivery,
  snapshotProgressPayload,
} from "./progress-delivery.js";
import type {
  DispatcherClient,
  TaskPayload,
} from "./types.js";

const HEARTBEAT_TIMEOUT_MS = 5_000;

interface DispatcherCallInput {
  method: string;
  pathname: string;
  body?: unknown;
  timeout?: number;
  signal?: AbortSignal;
}

export function createDispatcherClient(dispatcherUrl: string): DispatcherClient {
  const baseUrl = dispatcherUrl.replace(/\/$/, "");
  const progressDeliveryPolicy = resolveProgressDeliveryPolicy();

  async function call(input: DispatcherCallInput): Promise<unknown> {
    const url = `${baseUrl}${input.pathname}`;
    throwIfAborted(input.signal, `dispatcher request aborted: ${input.method} ${url}`);
    const authHeader = getDispatcherAuthHeader();
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
      const response = await fetch(url, buildRequestInit(
        input.method,
        input.body,
        controller,
        authHeader,
      ));
      return await parseDispatcherResponse(response, input.method, url);
    } catch (error) {
      if (input.signal?.aborted) {
        throw createAbortError(`dispatcher request aborted: ${input.method} ${url}`);
      }
      if (error instanceof DispatcherHttpError) {
        throw new DispatcherHttpError(
          `dispatcher request failed: ${input.method} ${url} - ${error.message}`,
          error.status,
        );
      }
      if (error instanceof DispatcherResponseError) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (timedOut) {
        throw new DispatcherTransportError(
          `dispatcher request failed: ${input.method} ${url} - timed out after ${timeoutMs}ms`,
        );
      }
      throw new DispatcherTransportError(
        `dispatcher request failed: ${input.method} ${url} - ${errorMessage}`,
      );
    } finally {
      clearTimeout(timeoutId);
      input.signal?.removeEventListener("abort", onAbort);
    }
  }

  return buildDispatcherClient(call, progressDeliveryPolicy);
}

function buildRequestInit(
  method: string,
  body: unknown,
  controller: AbortController,
  authHeader: Record<string, string>,
): RequestInit {
  return {
    method,
    headers: {
      "content-type": "application/json",
      ...authHeader,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: controller.signal,
  };
}

async function parseDispatcherResponse(response: Response, method: string, url: string): Promise<unknown> {
  const text = await response.text();
  let json: unknown = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch (error) {
      if (response.ok) {
        const message = error instanceof Error ? error.message : String(error);
        throw new DispatcherResponseError(
          `dispatcher response was not valid JSON: ${method} ${url} - ${message}`,
        );
      }
    }
  }
  if (!response.ok) {
    throw new DispatcherHttpError(
      readDispatcherHttpErrorMessage(json, text, `HTTP ${response.status}`),
      response.status,
    );
  }
  return json;
}

function buildDispatcherClient(
  call: (input: DispatcherCallInput) => Promise<unknown>,
  progressDeliveryPolicy: ReturnType<typeof resolveProgressDeliveryPolicy>,
): DispatcherClient {
  return {
    registerWorker: (worker, options) => call({
      method: "POST",
      pathname: "/api/workers/register",
      body: worker,
      signal: options?.signal,
    }),
    heartbeat: (workerId, payload, options) => {
      const stablePayload = snapshotHeartbeatPayload(payload);
      return retryHeartbeatDelivery({
        signal: options?.signal,
        send: () => call({
          method: "POST",
          pathname: `/api/workers/${encodeURIComponent(workerId)}/heartbeat`,
          body: stablePayload,
          timeout: HEARTBEAT_TIMEOUT_MS,
          signal: options?.signal,
        }),
      });
    },
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
    reportProgress: (workerId, payload, options) => {
      const stablePayload = snapshotProgressPayload(payload);
      return retryProgressDelivery({
        ...progressDeliveryPolicy,
        signal: options?.signal,
        send: () => call({
          method: "POST",
          pathname: `/api/workers/${encodeURIComponent(workerId)}/progress`,
          body: stablePayload,
          signal: options?.signal,
        }),
      });
    },
    submitResult: (workerId, payload, options) => call({
      method: "POST",
      pathname: `/api/workers/${encodeURIComponent(workerId)}/result`,
      body: payload,
      signal: options?.signal,
    }),
  };
}
