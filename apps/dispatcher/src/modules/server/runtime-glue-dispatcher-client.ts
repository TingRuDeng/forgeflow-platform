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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface DispatcherHttpClient extends DispatcherWorkerClient {
  registerWorker(worker: WorkerRegistration): Promise<unknown>;
  heartbeat(workerId: string, payload: HeartbeatPayload): Promise<unknown>;
  getAssignedTask(workerId: string): Promise<AssignedTaskResponse>;
  startTask(workerId: string, payload: StartTaskPayload): Promise<unknown>;
  submitResult(workerId: string, payload: SubmitResultPayload): Promise<unknown>;
}

export interface DispatcherStateDirClient {
  registerWorker(worker: WorkerRegistration): unknown;
  heartbeat(workerId: string, payload: HeartbeatPayload): unknown;
  getAssignedTask(workerId: string): unknown;
  startTask(workerId: string, payload: StartTaskPayload): unknown;
  submitResult(workerId: string, payload: SubmitResultPayload): unknown;
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
  };
}

export interface CreateDispatcherStateDirClientOptions {
  handleRequest: (input: {
    stateDir: string;
    method: string;
    pathname: string;
    body?: unknown;
  }) => { json: unknown };
}

export function createDispatcherStateDirClientFactory(
  options: CreateDispatcherStateDirClientOptions,
): (stateDir: string) => DispatcherStateDirClient {
  const { handleRequest } = options;

  return (stateDir: string): DispatcherStateDirClient => {
    return {
      registerWorker(worker: WorkerRegistration): unknown {
        return handleRequest({
          stateDir,
          method: "POST",
          pathname: "/api/workers/register",
          body: worker,
        }).json;
      },

      heartbeat(workerId: string, payload: HeartbeatPayload): unknown {
        return handleRequest({
          stateDir,
          method: "POST",
          pathname: `/api/workers/${encodeURIComponent(workerId)}/heartbeat`,
          body: payload,
        }).json;
      },

      getAssignedTask(workerId: string): unknown {
        return handleRequest({
          stateDir,
          method: "GET",
          pathname: `/api/workers/${encodeURIComponent(workerId)}/assigned-task`,
        }).json;
      },

      startTask(workerId: string, payload: StartTaskPayload): unknown {
        return handleRequest({
          stateDir,
          method: "POST",
          pathname: `/api/workers/${encodeURIComponent(workerId)}/start-task`,
          body: payload,
        }).json;
      },

      submitResult(workerId: string, payload: SubmitResultPayload): unknown {
        return handleRequest({
          stateDir,
          method: "POST",
          pathname: `/api/workers/${encodeURIComponent(workerId)}/result`,
          body: payload,
        }).json;
      },
    };
  };
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
  executeTask(task: unknown, assignment: unknown): Promise<TaskExecutionResult>;
}

export interface TaskExecutionResult {
  result: unknown;
  changedFiles: string[];
  pullRequest: { number: number; url: string; headBranch: string; baseBranch: string } | null;
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

  const assigned = await client.getAssignedTask(input.workerId);

  if (!assigned || !assigned.assignment || !assigned.task) {
    return {
      status: "idle",
      workerId: input.workerId,
    };
  }

  const taskId = (assigned.task as { id?: string })?.id ?? "unknown";

  await client.startTask(input.workerId, { taskId, at });

  let executionResult: TaskExecutionResult;
  if (input.taskExecutor) {
    executionResult = await input.taskExecutor.executeTask(assigned.task, assigned.assignment);
  } else if (input.dryRunExecution) {
    executionResult = {
      result: { dryRun: true, taskId },
      changedFiles: [],
      pullRequest: null,
    };
  } else {
    throw new Error("taskExecutor is required when dryRunExecution is false");
  }

  await client.submitResult(input.workerId, {
    result: executionResult.result,
    changedFiles: executionResult.changedFiles,
    pullRequest: executionResult.pullRequest,
  });

  return {
    status: "completed",
    workerId: input.workerId,
    taskId,
    changedFiles: executionResult.changedFiles,
    pullRequest: executionResult.pullRequest,
  };
}
