import type {
  DispatcherWorkerClient,
  WorkerDaemonCycleInput,
  WorkerDaemonCycleResult,
} from "./runtime-glue-types.js";
import { formatLocalTimestamp } from "../time.js";

function nowIso(): string {
  return formatLocalTimestamp();
}

export interface RunWorkerDaemonOptions extends WorkerDaemonCycleInput {
  pollIntervalMs?: number;
  once?: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runWorkerDaemon(
  input: RunWorkerDaemonOptions,
): Promise<WorkerDaemonCycleResult> {
  const pollIntervalMs = input.pollIntervalMs ?? 5000;

  while (true) {
    const { runWorkerDaemonCycle } = await import("./runtime-glue-dispatcher-client.js");
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
