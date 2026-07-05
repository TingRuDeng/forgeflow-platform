import os from "node:os";

import { createDispatcherClient } from "./dispatcher-client.js";
import { executeLiveWorkerTask, processTaskAssignment } from "./task-processor.js";
import { resolvePackageRootDir, nowIso, sleep } from "./utils.js";
import type { DispatcherClient, PullRequestInfo, TaskPayload } from "./types.js";

export { createDispatcherClient } from "./dispatcher-client.js";
export { buildWorkerProtocolEnvelope, executeLiveWorkerTask, submitFailedWorkerResult } from "./task-processor.js";
export { executeManagedWorkerTask } from "./managed-task-processor.js";
export type { DispatcherClient, PullRequestInfo, TaskAssignment, TaskInfo, TaskPayload, WorkerResult } from "./types.js";

export interface RunWorkerDaemonCycleInput {
  client?: DispatcherClient;
  dispatcherUrl?: string;
  workerId: string;
  pool: string;
  hostname?: string;
  labels?: string[];
  repoDir: string;
  packageRoot?: string;
  dryRunExecution?: boolean;
  at?: string;
}

export type RunWorkerDaemonCycleResult =
  | { status: string; workerId: string }
  | { status: string; taskId: string; workerId: string; worktreeDir: string; outputDir: string; changedFiles: string[]; pullRequest: PullRequestInfo | null };

export async function runWorkerDaemonCycle(input: RunWorkerDaemonCycleInput): Promise<RunWorkerDaemonCycleResult> {
  const client = input.client ?? createDispatcherClient(input.dispatcherUrl || "");
  const at = input.at ?? nowIso();

  await client.registerWorker({
    workerId: input.workerId,
    pool: input.pool,
    hostname: input.hostname ?? os.hostname(),
    labels: input.labels ?? [],
    repoDir: input.repoDir,
    at,
  });
  await client.heartbeat(input.workerId, { at });

  const assigned = await client.claimTask(input.workerId, { at }) as TaskPayload | null;
  if (!assigned || !assigned.assignment || !assigned.task) {
    return { status: "idle", workerId: input.workerId };
  }

  return processTaskAssignment({
    client,
    packageRoot: input.packageRoot ?? resolvePackageRootDir(),
    workerId: input.workerId,
    repoDir: input.repoDir,
    payload: assigned,
    dryRunExecution: Boolean(input.dryRunExecution),
    at,
  });
}

export interface RunWorkerDaemonInput extends RunWorkerDaemonCycleInput {
  once?: boolean;
  pollIntervalMs?: number;
}

export async function runWorkerDaemon(input: RunWorkerDaemonInput): Promise<RunWorkerDaemonCycleResult> {
  while (true) {
    const summary = await runWorkerDaemonCycle(input);
    if (input.once) {
      return summary;
    }
    await sleep(input.pollIntervalMs ?? 5000);
  }
}
