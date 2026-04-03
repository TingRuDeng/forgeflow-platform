import path from "node:path";

import type { WatchOptions, WatchResult, WatchSummaryResult } from "./types.js";

import { createJsonHttpClient, loadRuntimeState } from "./http.js";

const TERMINAL_TASK_STATUSES = new Set(["review", "failed", "merged", "blocked"]);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findTask(snapshot: { tasks?: Array<Record<string, unknown>> }, taskId: string) {
  return (snapshot.tasks ?? []).find((task) => task.id === taskId) ?? null;
}

export async function watchTask(options: WatchOptions & {
  fetchImpl?: typeof globalThis.fetch;
  stateDir?: string;
}): Promise<WatchResult | WatchSummaryResult> {
  const intervalMs = Number(options.intervalMs || 2000);
  const timeoutMs = Number(options.timeoutMs || 600_000);
  const startedAt = Date.now();
  let attempts = 0;

  if (options.stateDir) {
    const stateDir = path.resolve(options.stateDir);
    while (true) {
      attempts += 1;
      const state = loadRuntimeState(stateDir);
      const snapshot = state as unknown as { tasks?: Array<Record<string, unknown>> };
      const task = findTask(snapshot, options.taskId);
      const status = String(task?.status || "");

      if (task && TERMINAL_TASK_STATUSES.has(status)) {
        if (options.summary === true) {
          return {
            taskId: options.taskId,
            status,
            attempts,
            elapsedMs: Date.now() - startedAt,
          };
        }
        return {
          taskId: options.taskId,
          status,
          attempts,
          elapsedMs: Date.now() - startedAt,
          task,
          snapshot,
        };
      }

      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error(`watch timeout: ${options.taskId}`);
      }

      await sleep(intervalMs);
    }
  }

  const client = createJsonHttpClient(options.dispatcherUrl, {
    fetchImpl: options.fetchImpl,
  });

  while (true) {
    attempts += 1;
    const snapshot = await client.request("/api/dashboard/snapshot");
    const task = findTask(snapshot as { tasks?: Array<Record<string, unknown>> }, options.taskId);
    const status = String(task?.status || "");

    if (task && TERMINAL_TASK_STATUSES.has(status)) {
      if (options.summary === true) {
        return {
          taskId: options.taskId,
          status,
          attempts,
          elapsedMs: Date.now() - startedAt,
        };
      }
      return {
        taskId: options.taskId,
        status,
        attempts,
        elapsedMs: Date.now() - startedAt,
        task,
        snapshot,
      };
    }

    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`watch timeout: ${options.taskId}`);
    }

    await sleep(intervalMs);
  }
}
