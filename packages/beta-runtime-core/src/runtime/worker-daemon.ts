import { createDispatcherClient } from "./dispatcher-client.js";
import { executeLiveWorkerTask, submitFailedWorkerResult } from "./task-processor.js";
import { resolvePackageRootDir, sleep } from "./utils.js";
import {
  runSharedWorkerDaemonCycle,
  type SharedWorkerDaemonCycleResult,
  type TaskExecutionResult,
} from "./worker-daemon-cycle.js";
import type { DispatcherClient, PullRequestInfo, TaskPayload } from "./types.js";

export { createDispatcherClient } from "./dispatcher-client.js";
export {
  DEFAULT_WORKER_EXECUTION_TIMEOUT_MS,
  WorkerResultDeliveryError,
  buildWorkerProtocolEnvelope,
  executeLiveWorkerTask,
  resolveWorkerExecutionTimeoutMs,
  submitFailedWorkerResult,
} from "./task-processor.js";
export {
  DEFAULT_SUBMIT_RESULT_MAX_RETRIES,
  DEFAULT_SUBMIT_RESULT_RETRY_DELAY_MS,
  executeManagedWorkerTask,
  resolveManagedWorkerTaskRetryPolicy,
} from "./managed-task-processor.js";
export { runSharedWorkerDaemonCycle } from "./worker-daemon-cycle.js";
export type { SharedWorkerDaemonCycleInput, SharedWorkerDaemonCycleResult, TaskExecutor, TaskExecutionResult } from "./worker-daemon-cycle.js";
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
  signal?: AbortSignal;
}

export type RunWorkerDaemonCycleResult =
  | { status: string; workerId: string }
  | { status: string; taskId: string; workerId: string; worktreeDir: string; outputDir: string; changedFiles: string[]; pullRequest: PullRequestInfo | null };

async function executeAssignedTask(input: {
  client: DispatcherClient;
  packageRoot: string;
  workerId: string;
  repoDir: string;
  payload: TaskPayload;
  dryRunExecution: boolean;
  at?: string;
  signal?: AbortSignal;
}): Promise<TaskExecutionResult> {
  try {
    return await executeLiveWorkerTask(input);
  } catch (error) {
    await submitFailedWorkerResult({
      input,
      taskId: input.payload.task.id,
      error,
    });
    throw error;
  }
}

export async function runWorkerDaemonCycle(input: RunWorkerDaemonCycleInput): Promise<RunWorkerDaemonCycleResult> {
  if (input.signal?.aborted) {
    return { status: "stopped", workerId: input.workerId };
  }
  const client = input.client ?? createDispatcherClient(input.dispatcherUrl || "");
  const packageRoot = input.packageRoot ?? resolvePackageRootDir();
  const summary: SharedWorkerDaemonCycleResult = await runSharedWorkerDaemonCycle({
    client,
    workerId: input.workerId,
    pool: input.pool,
    hostname: input.hostname,
    labels: input.labels,
    repoDir: input.repoDir,
    dryRunExecution: input.dryRunExecution,
    at: input.at,
    signal: input.signal,
    taskExecutor: {
      executeTask: (_task, _assignment, payload) => executeAssignedTask({
        client,
        packageRoot,
        workerId: input.workerId,
        repoDir: input.repoDir,
        payload,
        dryRunExecution: Boolean(input.dryRunExecution),
        at: input.at,
        signal: input.signal,
      }),
    },
  });
  return summary as RunWorkerDaemonCycleResult;
}

export interface RunWorkerDaemonInput extends RunWorkerDaemonCycleInput {
  once?: boolean;
  pollIntervalMs?: number;
}

export async function runWorkerDaemon(input: RunWorkerDaemonInput): Promise<RunWorkerDaemonCycleResult> {
  while (!input.signal?.aborted) {
    let summary: RunWorkerDaemonCycleResult;
    try {
      summary = await runWorkerDaemonCycle(input);
    } catch (error) {
      if (input.signal?.aborted) {
        return { status: "stopped", workerId: input.workerId };
      }
      throw error;
    }
    if (input.once) {
      return summary;
    }
    await sleepUntilAborted(input.pollIntervalMs ?? 5000, input.signal);
  }
  return { status: "stopped", workerId: input.workerId };
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
