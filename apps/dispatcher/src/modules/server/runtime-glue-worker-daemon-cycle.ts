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

  while (true) {
    const summary = await runWorkerDaemonCycle({
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
    });

    if (input.once) {
      return summary;
    }

    await sleep(pollIntervalMs);
  }
}
