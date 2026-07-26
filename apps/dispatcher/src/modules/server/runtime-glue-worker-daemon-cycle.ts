import { runSharedWorkerDaemonCycle } from "@tingrudeng/beta-runtime-core";

import type { DispatcherClient as RuntimeDispatcherClient } from "@tingrudeng/beta-runtime-core";
import type {
  AssignedTaskResponse,
  WorkerDaemonCycleInput,
  WorkerDaemonCycleResult,
} from "./runtime-glue-types.js";
import { formatLocalTimestamp } from "../time.js";

export type { WorkerDaemonCycleResult } from "./runtime-glue-types.js";

export interface RunWorkerDaemonOptions extends WorkerDaemonCycleInput {
  pollIntervalMs?: number;
  once?: boolean;
}

export interface CreateWorkerDaemonCycleOptions extends WorkerDaemonCycleInput {
  taskExecutor?: TaskExecutor;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sleepUntilAborted(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return sleep(ms);
  }
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    function finish() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    }
    signal.addEventListener("abort", finish, { once: true });
  });
}

export async function runWorkerDaemonCycle(
  input: CreateWorkerDaemonCycleOptions,
): Promise<WorkerDaemonCycleResult> {
  const client = input.client;
  if (!client) {
    throw new Error("dispatcher client is required");
  }
  const runtimeClient = client as unknown as RuntimeDispatcherClient;

  return await runSharedWorkerDaemonCycle({
    client: runtimeClient,
    workerId: input.workerId,
    pool: input.pool,
    hostname: input.hostname,
    labels: input.labels,
    repoDir: input.repoDir,
    dryRunExecution: input.dryRunExecution,
    at: input.at,
    now: formatLocalTimestamp,
    signal: input.signal,
    taskExecutor: input.taskExecutor
      ? {
          executeTask: (task, assignment, assigned) =>
            input.taskExecutor?.executeTask(task, assignment, assigned as AssignedTaskResponse) as Promise<TaskExecutionResult>,
        }
      : undefined,
  }) as WorkerDaemonCycleResult;
}

export async function runWorkerDaemon(
  input: RunWorkerDaemonOptions,
): Promise<WorkerDaemonCycleResult> {
  const pollIntervalMs = input.pollIntervalMs ?? 5000;

  while (!input.signal?.aborted) {
    let summary: WorkerDaemonCycleResult;
    try {
      summary = await runWorkerDaemonCycle({
        client: input.client,
        dispatcherUrl: input.dispatcherUrl,
        workerId: input.workerId,
        pool: input.pool,
        hostname: input.hostname,
        labels: input.labels,
        repoDir: input.repoDir,
        repoRoot: input.repoRoot,
        dryRunExecution: input.dryRunExecution,
        at: input.at,
        signal: input.signal,
      });
    } catch (error) {
      if (input.signal?.aborted) {
        return { status: "stopped", workerId: input.workerId };
      }
      throw error;
    }

    if (input.once) {
      return summary;
    }

    await sleepUntilAborted(pollIntervalMs, input.signal);
  }
  return { status: "stopped", workerId: input.workerId };
}
