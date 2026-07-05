import os from "node:os";

import type {
  DispatcherWorkerClient,
  WorkerRegistration,
  HeartbeatPayload,
  StartTaskPayload,
  SubmitResultPayload,
  AssignedTaskResponse,
} from "./runtime-glue-types.js";
import { formatLocalTimestamp } from "../time.js";

const HEARTBEAT_TIMEOUT_MS = 5_000;
const HEARTBEAT_MAX_RETRIES = 3;
const HEARTBEAT_RETRY_DELAY_MS = 1_000;
const SUBMIT_RESULT_MAX_RETRIES = 3;
const SUBMIT_RESULT_RETRY_DELAY_MS = 2_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface DispatcherHttpClient extends DispatcherWorkerClient {
  registerWorker(worker: WorkerRegistration): Promise<unknown>;
  heartbeat(workerId: string, payload: HeartbeatPayload): Promise<unknown>;
  getAssignedTask(workerId: string): Promise<AssignedTaskResponse>;
  claimTask(workerId: string, payload?: { at?: string }): Promise<AssignedTaskResponse>;
  startTask(workerId: string, payload: StartTaskPayload): Promise<unknown>;
  submitResult(workerId: string, payload: SubmitResultPayload): Promise<unknown>;
}

export interface DispatcherStateDirClient {
  registerWorker(worker: WorkerRegistration): Promise<unknown>;
  heartbeat(workerId: string, payload: HeartbeatPayload): Promise<unknown>;
  getAssignedTask(workerId: string): Promise<unknown>;
  claimTask(workerId: string, payload?: { at?: string }): Promise<unknown>;
  startTask(workerId: string, payload: StartTaskPayload): Promise<unknown>;
  submitResult(workerId: string, payload: SubmitResultPayload): Promise<unknown>;
  reportEvent(workerId: string, payload: { type: string; taskId?: string; payload?: unknown; at?: string }): Promise<unknown>;
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
    callOptions: { timeout?: number } = {},
  ): Promise<unknown> {
    const url = `${baseUrl}${pathname}`;
    const timeoutMs = callOptions.timeout ?? defaultTimeout;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

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
      clearTimeout(timeoutId);
      const text = await response.text();
      const json = text ? JSON.parse(text) : {};
      if (!response.ok) {
        throw new Error(
          json.error || text || `dispatcher request failed: ${method} ${url} -> ${response.status}`,
        );
      }
      return json;
    } catch (error) {
      clearTimeout(timeoutId);
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`dispatcher request failed: ${method} ${url} - ${errorMessage}`);
    }
  }

  async function callWithRetry(
    method: string,
    pathname: string,
    body: unknown,
    callOptions: { timeout?: number; maxRetries?: number; retryDelayMs?: number } = {},
  ): Promise<unknown> {
    const maxRetries = callOptions.maxRetries ?? 0;
    const retryDelayMs = callOptions.retryDelayMs ?? 1_000;
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await call(method, pathname, body, { timeout: callOptions.timeout });
      } catch (error) {
        lastError = error;
        if (attempt < maxRetries) {
          await sleep(retryDelayMs);
        }
      }
    }
    throw lastError;
  }

  return {
    registerWorker(worker: WorkerRegistration): Promise<unknown> {
      return call("POST", "/api/workers/register", worker) as Promise<unknown>;
    },

    heartbeat(workerId: string, payload: HeartbeatPayload): Promise<unknown> {
      return callWithRetry(
        "POST",
        `/api/workers/${encodeURIComponent(workerId)}/heartbeat`,
        payload,
        {
          timeout: HEARTBEAT_TIMEOUT_MS,
          maxRetries: HEARTBEAT_MAX_RETRIES,
          retryDelayMs: HEARTBEAT_RETRY_DELAY_MS,
        },
      ) as Promise<unknown>;
    },

    getAssignedTask(workerId: string): Promise<AssignedTaskResponse> {
      return call(
        "GET",
        `/api/workers/${encodeURIComponent(workerId)}/assigned-task`,
        undefined,
      ) as Promise<AssignedTaskResponse>;
    },

    claimTask(workerId: string, payload?: { at?: string }): Promise<AssignedTaskResponse> {
      return call(
        "POST",
        `/api/workers/${encodeURIComponent(workerId)}/claim-task`,
        payload ?? {},
      ) as Promise<AssignedTaskResponse>;
    },

    startTask(workerId: string, payload: StartTaskPayload): Promise<unknown> {
      return call(
        "POST",
        `/api/workers/${encodeURIComponent(workerId)}/start-task`,
        payload,
      ) as Promise<unknown>;
    },

    submitResult(workerId: string, payload: SubmitResultPayload): Promise<unknown> {
      return call(
        "POST",
        `/api/workers/${encodeURIComponent(workerId)}/result`,
        payload,
      ) as Promise<unknown>;
    },

    reportEvent(workerId: string, payload: { type: string; taskId?: string; payload?: unknown; at?: string }): Promise<unknown> {
      return call(
        "POST",
        `/api/workers/${encodeURIComponent(workerId)}/events`,
        payload,
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
      async registerWorker(worker: WorkerRegistration): Promise<unknown> {
        return readStateDirResponseJson(await handleRequest({
          stateDir,
          method: "POST",
          pathname: "/api/workers/register",
          body: worker,
          internalCall: true,
        }));
      },

      async heartbeat(workerId: string, payload: HeartbeatPayload): Promise<unknown> {
        return readStateDirResponseJson(await handleRequest({
          stateDir,
          method: "POST",
          pathname: `/api/workers/${encodeURIComponent(workerId)}/heartbeat`,
          body: payload,
          internalCall: true,
        }));
      },

      async getAssignedTask(workerId: string): Promise<unknown> {
        return readStateDirResponseJson(await handleRequest({
          stateDir,
          method: "GET",
          pathname: `/api/workers/${encodeURIComponent(workerId)}/assigned-task`,
          internalCall: true,
        }));
      },

      async claimTask(workerId: string, payload?: { at?: string }): Promise<unknown> {
        return readStateDirResponseJson(await handleRequest({
          stateDir,
          method: "POST",
          pathname: `/api/workers/${encodeURIComponent(workerId)}/claim-task`,
          body: payload ?? {},
          internalCall: true,
        }));
      },

      async startTask(workerId: string, payload: StartTaskPayload): Promise<unknown> {
        return readStateDirResponseJson(await handleRequest({
          stateDir,
          method: "POST",
          pathname: `/api/workers/${encodeURIComponent(workerId)}/start-task`,
          body: payload,
          internalCall: true,
        }));
      },

      async submitResult(workerId: string, payload: SubmitResultPayload): Promise<unknown> {
        return readStateDirResponseJson(await handleRequest({
          stateDir,
          method: "POST",
          pathname: `/api/workers/${encodeURIComponent(workerId)}/result`,
          body: payload,
          internalCall: true,
        }));
      },

      async reportEvent(workerId: string, payload: { type: string; taskId?: string; payload?: unknown; at?: string }): Promise<unknown> {
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
  const token = process.env.DISPATCHER_API_TOKEN;
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

export interface CreateWorkerDaemonCycleOptions {
  client?: DispatcherWorkerClient;
  dispatcherUrl?: string;
  workerId: string;
  pool: string;
  hostname?: string;
  labels?: string[];
  repoDir: string;
  repoRoot?: string;
  dryRunExecution?: boolean;
  taskExecutor?: TaskExecutor;
  at?: string;
}

export interface TaskExecutor {
  executeTask(task: unknown, assignment: unknown, assigned: AssignedTaskResponse): Promise<TaskExecutionResult>;
}

export interface TaskExecutionResult {
  result: unknown;
  changedFiles: string[];
  pullRequest: { number: number; url: string; headBranch: string; baseBranch: string } | null;
  worktreeDir?: string;
  outputDir?: string;
}

export interface WorkerDaemonCycleResult {
  status: "idle" | "completed";
  workerId: string;
  taskId?: string;
  worktreeDir?: string;
  outputDir?: string;
  changedFiles?: string[];
  pullRequest?: { number: number; url: string; headBranch: string; baseBranch: string } | null;
}

function nowIso(): string {
  return formatLocalTimestamp();
}

function buildWorkerProtocolEnvelope(assigned: AssignedTaskResponse) {
  return {
    attemptId: assigned.attemptId,
    leaseToken: assigned.leaseToken,
    protocolVersion: assigned.protocolVersion,
    traceId: assigned.traceId,
    idempotencyKey: assigned.idempotencyKey,
  };
}

function getSubmitResultMaxRetries(): number {
  return Number(process.env.WORKER_DAEMON_SUBMIT_RESULT_MAX_RETRIES || SUBMIT_RESULT_MAX_RETRIES);
}

function getSubmitResultRetryDelayMs(): number {
  return Number(process.env.WORKER_DAEMON_SUBMIT_RESULT_RETRY_DELAY_MS || SUBMIT_RESULT_RETRY_DELAY_MS);
}

async function reportWorkerEventBestEffort(
  client: DispatcherWorkerClient,
  workerId: string,
  payload: { type: string; taskId?: string; payload?: unknown; at?: string },
): Promise<void> {
  if (typeof client.reportEvent !== "function") {
    return;
  }
  try {
    await client.reportEvent(workerId, {
      ...payload,
      at: payload.at ?? nowIso(),
    });
  } catch {
    // 事件回报是诊断增强，不能遮蔽主链 submitResult 的真实失败。
  }
}

async function submitResultWithRetry(input: {
  client: DispatcherWorkerClient;
  workerId: string;
  taskId: string;
  payload: SubmitResultPayload;
}): Promise<void> {
  const maxRetries = getSubmitResultMaxRetries();
  const retryDelayMs = getSubmitResultRetryDelayMs();
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      await input.client.submitResult(input.workerId, input.payload);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await reportWorkerEventBestEffort(input.client, input.workerId, {
        type: "submit_result_retry_failed",
        taskId: input.taskId,
        payload: {
          attempt,
          maxRetries,
          error: lastError,
        },
      });
      if (attempt < maxRetries) {
        await sleep(retryDelayMs);
      }
    }
  }

  await reportWorkerEventBestEffort(input.client, input.workerId, {
    type: "delivery_failed",
    taskId: input.taskId,
    payload: {
      stage: "submit_result",
      error: lastError,
      failureCode: "delivery_failed",
    },
  });
  throw new Error(`submitResult failed after ${maxRetries} attempts: ${lastError}`);
}

export async function runWorkerDaemonCycle(
  input: CreateWorkerDaemonCycleOptions,
): Promise<WorkerDaemonCycleResult> {
  const client = input.client;
  const at = input.at ?? nowIso();

  if (!client) {
    throw new Error("dispatcher client is required");
  }

  await client.registerWorker({
    workerId: input.workerId,
    pool: input.pool,
    hostname: input.hostname ?? os.hostname(),
    labels: input.labels ?? [],
    repoDir: input.repoDir,
    at,
  });

  await client.heartbeat(input.workerId, { at });

  const assigned = await client.claimTask(input.workerId, { at });

  if (!assigned || !assigned.assignment || !assigned.task) {
    return {
      status: "idle",
      workerId: input.workerId,
    };
  }

  const taskId = (assigned.task as { id?: string })?.id ?? "unknown";
  const envelope = buildWorkerProtocolEnvelope(assigned);

  await client.startTask(input.workerId, { taskId, ...envelope, at });

  let executionResult: TaskExecutionResult;
  if (input.taskExecutor) {
    executionResult = await input.taskExecutor.executeTask(assigned.task, assigned.assignment, assigned);
  } else if (input.dryRunExecution) {
    executionResult = {
      result: { dryRun: true, taskId },
      changedFiles: [],
      pullRequest: null,
    };
  } else {
    throw new Error("taskExecutor is required when dryRunExecution is false");
  }

  await submitResultWithRetry({
    client,
    workerId: input.workerId,
    taskId,
    payload: {
      ...envelope,
      result: executionResult.result,
      changedFiles: executionResult.changedFiles,
      pullRequest: executionResult.pullRequest,
    },
  });

  return {
    status: "completed",
    workerId: input.workerId,
    taskId,
    worktreeDir: executionResult.worktreeDir,
    outputDir: executionResult.outputDir,
    changedFiles: executionResult.changedFiles,
    pullRequest: executionResult.pullRequest,
  };
}
