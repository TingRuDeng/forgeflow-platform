import { randomUUID } from "node:crypto";
import * as http from "node:http";
import * as https from "node:https";

import { readDispatcherTokenFromConfig } from "../config.js";
import {
  DispatcherHttpError,
  DispatcherResponseError,
  DispatcherTransportError,
  normalizeOptionalDispatcherToken,
  readDispatcherHttpErrorMessage,
  resolveDispatcherAuthToken,
  resolveProgressDeliveryPolicy,
  retryHeartbeatDelivery,
  retryProgressDelivery,
  snapshotHeartbeatPayload,
  snapshotProgressPayload,
} from "@tingrudeng/beta-runtime-core";
import type { TraeWorkerArtifactBundle } from "./trae-worker-artifacts.js";

interface WorkerFailure {
  kind: "preflight" | "execution" | "verification" | "unknown";
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

interface WorkerEvidence {
  failureType?: string;
  failureSummary?: string;
  blockers?: WorkerFailure[];
  findings?: unknown[];
  artifacts?: Record<string, string>;
}

interface WorkerProtocolEnvelopeInput {
  attemptId?: string;
  leaseToken?: string;
  protocolVersion?: string;
  traceId?: string;
  idempotencyKey?: string;
}

const DEFAULT_DISPATCHER_URL = "http://127.0.0.1:8787";
const DEFAULT_AUTOMATION_URL = "http://127.0.0.1:8790";
const DEFAULT_DISPATCHER_REQUEST_TIMEOUT_MS = Number(process.env.TRAE_AUTOMATION_DISPATCHER_TIMEOUT_MS || 30000);
const DEFAULT_CHAT_RESPONSE_TIMEOUT_MS = Number(process.env.TRAE_AUTOMATION_CHAT_TIMEOUT_MS || 1200000);
const DEFAULT_CHAT_REQUEST_TIMEOUT_BUFFER_MS = Number(
  process.env.TRAE_AUTOMATION_CHAT_REQUEST_TIMEOUT_BUFFER_MS || 30000
);

export interface JsonHttpClientOptions {
  fetchImpl?: typeof globalThis.fetch;
  requestTimeoutMs?: number;
  sourceLabel?: string;
  dispatcherToken?: string;
  nodeRequestImpl?: (
    url: string,
    init: {
      method: string;
      headers?: Record<string, string>;
      body?: string;
      timeoutMs: number;
      signal?: AbortSignal;
    },
  ) => Promise<JsonHttpResponse>;
}

export interface JsonHttpRequestOptions {
  method?: string;
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
}

interface JsonHttpResponse {
  ok: boolean;
  status: number;
  text: string;
}

async function requestWithNodeTransport(
  urlString: string,
  init: {
    method: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs: number;
    signal?: AbortSignal;
  },
): Promise<JsonHttpResponse> {
  const url = new URL(urlString);
  const transport = url.protocol === "https:" ? https : http;

  return await new Promise((resolve, reject) => {
    const request = transport.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: init.method,
      headers: init.headers,
    }, (response) => {
      const chunks: string[] = [];
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        chunks.push(chunk);
      });
      response.on("end", () => {
        const status = Number(response.statusCode || 0);
        resolve({
          ok: status >= 200 && status < 300,
          status,
          text: chunks.join(""),
        });
      });
    });

    const abortRequest = () => {
      const error = new Error("Request aborted");
      error.name = "AbortError";
      request.destroy(error);
    };
    const timeoutId = setTimeout(abortRequest, init.timeoutMs);
    const cleanup = () => {
      clearTimeout(timeoutId);
      init.signal?.removeEventListener("abort", abortRequest);
    };

    request.on("error", (error) => {
      cleanup();
      reject(error);
    });

    request.on("close", cleanup);

    if (init.signal?.aborted) {
      abortRequest();
      return;
    }
    init.signal?.addEventListener("abort", abortRequest, { once: true });

    if (init.body) {
      request.write(init.body);
    }
    request.end();
  });
}

export function createJsonHttpClient(baseUrl: string, options: JsonHttpClientOptions = {}) {
  const fetchImpl = options.fetchImpl;
  const nodeRequestImpl = options.nodeRequestImpl || requestWithNodeTransport;
  const base = String(baseUrl || "").replace(/\/$/, "");
  const sourceLabel = String(options.sourceLabel || "").trim();

  async function request(path: string, init: JsonHttpRequestOptions = {}) {
    const method = init.method || "GET";
    const environmentToken = typeof process !== "undefined"
      ? resolveDispatcherAuthToken(process.env)
      : undefined;
    const explicitToken = environmentToken === undefined
      ? normalizeOptionalDispatcherToken(options.dispatcherToken, "Trae dispatcherToken option")
      : undefined;
    const configToken = environmentToken === undefined && explicitToken === undefined
      ? normalizeOptionalDispatcherToken(
        readDispatcherTokenFromConfig(),
        "Trae config dispatcherToken",
      )
      : undefined;
    const dispatcherToken = environmentToken ?? explicitToken ?? configToken;
    const headers: Record<string, string> = {};
    if (init.body) headers["content-type"] = "application/json";
    if (dispatcherToken !== undefined) {
      headers["Authorization"] = `Bearer ${dispatcherToken}`;
    }
    const body = init.body ? JSON.stringify(init.body) : undefined;
    const controller = new AbortController();
    const timeoutMs = Number(init.timeoutMs || 10000);
    let timedOut = false;
    const abortFromCaller = () => controller.abort(init.signal?.reason);
    if (init.signal?.aborted) {
      abortFromCaller();
    } else {
      init.signal?.addEventListener("abort", abortFromCaller, { once: true });
    }
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const response = fetchImpl
        ? await fetchImpl(`${base}${path}`, {
          method,
          headers,
          body,
          signal: controller.signal,
        }).then(async (result) => ({
          ok: result.ok,
          status: result.status,
          text: await result.text(),
        }))
        : await nodeRequestImpl(`${base}${path}`, {
          method,
          headers,
          body,
          timeoutMs,
          signal: controller.signal,
        });

      let json: Record<string, unknown> = {};
      if (response.text) {
        try {
          json = JSON.parse(response.text) as Record<string, unknown>;
        } catch (error) {
          if (response.ok) {
            const message = error instanceof Error ? error.message : String(error);
            throw new DispatcherResponseError(
              `${sourceLabel || "request"} ${path} returned invalid JSON: ${message}`,
            );
          }
        }
      }
      if (!response.ok) {
        throw new DispatcherHttpError(
          readDispatcherHttpErrorMessage(json, response.text, `HTTP ${response.status}`),
          response.status,
        );
      }
      return json;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof Error && error.name === "AbortError") {
        if (!timedOut && init.signal?.aborted) {
          const aborted = new Error(sourceLabel
            ? `${sourceLabel} ${path} failed: request aborted`
            : `request aborted: ${path}`);
          aborted.name = "AbortError";
          throw aborted;
        }
        const timeoutMessage = `request timeout: ${path}`;
        throw new DispatcherTransportError(
          sourceLabel ? `${sourceLabel} ${path} failed: ${timeoutMessage}` : timeoutMessage,
        );
      }
      if (error instanceof DispatcherHttpError) {
        throw new DispatcherHttpError(
          sourceLabel ? `${sourceLabel} ${path} failed: ${error.message}` : error.message,
          error.status,
        );
      }
      if (error instanceof DispatcherResponseError) {
        throw error;
      }
      throw new DispatcherTransportError(
        sourceLabel ? `${sourceLabel} ${path} failed: ${message}` : message,
      );
    } finally {
      clearTimeout(timeoutId);
      init.signal?.removeEventListener("abort", abortFromCaller);
    }
  }

  return { request };
}

export function createDispatcherClient(baseUrl = DEFAULT_DISPATCHER_URL, options: JsonHttpClientOptions = {}) {
  const http = createJsonHttpClient(baseUrl, {
    ...options,
    sourceLabel: options.sourceLabel || "dispatcher",
  });
  const requestTimeoutMs = Number(options.requestTimeoutMs || DEFAULT_DISPATCHER_REQUEST_TIMEOUT_MS);
  const progressDeliveryPolicy = resolveProgressDeliveryPolicy();
  const attemptLeases = new Map<string, Required<WorkerProtocolEnvelopeInput>>();

  function captureAttemptLease(response: unknown): void {
    const task = response && typeof response === "object" && "task" in response
      ? (response as { task?: Record<string, unknown> }).task
      : undefined;
    const taskId = typeof task?.task_id === "string" ? task.task_id.trim() : "";
    const attemptId = typeof task?.attempt_id === "string" ? task.attempt_id.trim() : "";
    const leaseToken = typeof task?.lease_token === "string" ? task.lease_token.trim() : "";
    const protocolVersion = typeof task?.protocol_version === "string" ? task.protocol_version.trim() : "";
    const traceId = typeof task?.trace_id === "string" ? task.trace_id.trim() : "";
    const idempotencyKey = typeof task?.idempotency_key === "string" ? task.idempotency_key.trim() : "";
    if (taskId && attemptId && leaseToken && protocolVersion && traceId && idempotencyKey) {
      attemptLeases.set(taskId, { attemptId, leaseToken, protocolVersion, traceId, idempotencyKey });
    }
  }

  function requireAttemptLease(taskId: string): Required<WorkerProtocolEnvelopeInput> {
    const attemptLease = attemptLeases.get(taskId);
    if (!attemptLease) {
      throw new Error(`worker protocol v1 envelope unavailable for task: ${taskId}`);
    }
    return attemptLease;
  }

  return {
    async register(worker: { workerId: string; pool: string; repoDir: string; labels?: string[] }) {
      return http.request("/api/trae/register", {
        method: "POST",
        body: {
          worker_id: worker.workerId,
          pool: worker.pool,
          repo_dir: worker.repoDir,
          labels: worker.labels || [],
        },
        timeoutMs: requestTimeoutMs,
      });
    },
    async fetchTask(workerId: string, repoDir: string, requestOptions: { signal?: AbortSignal } = {}) {
      const response = await http.request("/api/trae/fetch-task", {
        method: "POST",
        body: { worker_id: workerId, repo_dir: repoDir },
        timeoutMs: requestTimeoutMs,
        signal: requestOptions.signal,
      });
      captureAttemptLease(response);
      return response;
    },
    async startTask(
      workerId: string,
      taskId: string,
      attemptLease: WorkerProtocolEnvelopeInput = {},
      requestOptions: { signal?: AbortSignal } = {},
    ) {
      return http.request("/api/trae/start-task", {
        method: "POST",
        body: {
          worker_id: workerId,
          task_id: taskId,
          attempt_id: attemptLease.attemptId,
          lease_token: attemptLease.leaseToken,
          protocol_version: attemptLease.protocolVersion,
          trace_id: attemptLease.traceId,
          idempotency_key: attemptLease.idempotencyKey,
        },
        timeoutMs: requestTimeoutMs,
        signal: requestOptions.signal,
      });
    },
    async reportProgress(
      taskId: string,
      message: string,
      workerId: string,
      requestOptions: { signal?: AbortSignal } = {},
    ) {
      const body = snapshotProgressPayload({
        taskId,
        ...requireAttemptLease(taskId),
        progressId: randomUUID(),
        message,
      });
      return retryProgressDelivery({
        ...progressDeliveryPolicy,
        signal: requestOptions.signal,
        send: () => http.request(`/api/workers/${encodeURIComponent(workerId)}/progress`, {
          method: "POST",
          body,
          timeoutMs: requestTimeoutMs,
          signal: requestOptions.signal,
        }),
      });
    },
    async reportEvent(workerId: string, input: {
      type: string;
      taskId?: string;
      at?: string;
      payload?: Record<string, unknown>;
    }) {
      return http.request(`/api/workers/${encodeURIComponent(workerId)}/events`, {
        method: "POST",
        body: {
          type: input.type,
          taskId: input.taskId,
          at: input.at,
          payload: input.payload,
        },
        timeoutMs: requestTimeoutMs,
      });
    },
    async submitResult(input: {
      taskId: string;
      attemptId?: string;
      leaseToken?: string;
      protocolVersion?: string;
      traceId?: string;
      idempotencyKey?: string;
      status: string;
      summary: string;
      testOutput: string;
      risks: string[];
      filesChanged: string[];
      github?: {
        branchName?: string | null;
        commitSha?: string | null;
        pushStatus?: string;
        pushError?: string | null;
        prNumber?: number | null;
        prUrl?: string | null;
      };
      evidence?: WorkerEvidence;
      artifactBundle?: TraeWorkerArtifactBundle;
    }, requestOptions: { signal?: AbortSignal } = {}) {
      return http.request("/api/trae/submit-result", {
        method: "POST",
        body: {
          task_id: input.taskId,
          attempt_id: input.attemptId,
          lease_token: input.leaseToken,
          protocol_version: input.protocolVersion,
          trace_id: input.traceId,
          idempotency_key: input.idempotencyKey,
          status: input.status,
          summary: input.summary,
          test_output: input.testOutput,
          risks: input.risks,
          files_changed: input.filesChanged,
          branch_name: input.github?.branchName,
          commit_sha: input.github?.commitSha,
          push_status: input.github?.pushStatus,
          push_error: input.github?.pushError,
          pr_number: input.github?.prNumber,
          pr_url: input.github?.prUrl,
          evidence: input.evidence,
          artifact_bundle: input.artifactBundle,
        },
        timeoutMs: requestTimeoutMs,
        signal: requestOptions.signal,
      });
    },
    async heartbeat(workerId: string, requestOptions: { signal?: AbortSignal } = {}) {
      const body = snapshotHeartbeatPayload({ worker_id: workerId });
      return retryHeartbeatDelivery({
        signal: requestOptions.signal,
        send: () => http.request("/api/trae/heartbeat", {
          method: "POST",
          body,
          timeoutMs: requestTimeoutMs,
          signal: requestOptions.signal,
        }),
      });
    },
  };
}

function buildReadyPath(input: { discovery?: { titleContains?: string[]; urlContains?: string[] } } = {}) {
  const discovery = input.discovery || null;
  if (!discovery) {
    return "/ready";
  }
  const params = new URLSearchParams();
  if (Array.isArray(discovery.titleContains) && discovery.titleContains.length > 0) {
    params.set("title_contains", discovery.titleContains.join(","));
  }
  if (Array.isArray(discovery.urlContains) && discovery.urlContains.length > 0) {
    params.set("url_contains", discovery.urlContains.join(","));
  }
  const query = params.toString();
  return query ? `/ready?${query}` : "/ready";
}

export function createAutomationGatewayClient(baseUrl = DEFAULT_AUTOMATION_URL, options: JsonHttpClientOptions = {}) {
  const http = createJsonHttpClient(baseUrl, {
    ...options,
    sourceLabel: options.sourceLabel || "automation",
  });

  return {
    async ready(input: { discovery?: { titleContains?: string[]; urlContains?: string[] } } = {}) {
      return http.request(buildReadyPath(input));
    },
    async prepareSession(input: { discovery?: { titleContains?: string[]; urlContains?: string[] }; chatMode?: string } = {}) {
      return http.request("/v1/sessions/prepare", {
        method: "POST",
        body: {
          discovery: input.discovery || null,
          chatMode: input.chatMode || "new_chat",
        },
      });
    },
    async getSession(sessionId: string) {
      return http.request(`/v1/sessions/${encodeURIComponent(sessionId)}`);
    },
    async releaseSession(sessionId: string) {
      return http.request(`/v1/sessions/${encodeURIComponent(sessionId)}/release`, {
        method: "POST",
      });
    },
    async sendChat(input: {
      content: string;
      sessionId?: string | null;
      expectedTaskId?: string | null;
      prepare?: boolean;
      discovery?: unknown;
      chatMode?: string;
      responseRequiredPrefix?: string | null;
      responseTimeoutMs?: number;
      timeoutMs?: number;
    }) {
      const responseTimeoutMs = Number(input.responseTimeoutMs || DEFAULT_CHAT_RESPONSE_TIMEOUT_MS);
      return http.request("/v1/chat", {
        method: "POST",
        body: {
          content: input.content,
          sessionId: input.sessionId || null,
          expectedTaskId: input.expectedTaskId || null,
          prepare: input.prepare !== false,
          discovery: input.discovery || null,
          chatMode: input.chatMode || null,
          responseRequiredPrefix: input.responseRequiredPrefix || null,
          responseTimeoutMs,
        },
        timeoutMs: Number(input.timeoutMs || responseTimeoutMs + DEFAULT_CHAT_REQUEST_TIMEOUT_BUFFER_MS),
      });
    },
  };
}
