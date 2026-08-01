import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);
const workerDaemonHooksModulePath = path.join(repoRoot, "scripts/lib/worker-daemon-hooks.js");

describe("worker daemon hooks", () => {
  it("reuses a progress event id when the same logical event is replayed", async () => {
    const { reportWorkerEventBestEffort } = await import(workerDaemonHooksModulePath);
    const reported: Array<{ taskId: string; progressId: string; message: string; stage?: string }> = [];
    const client = {
      reportProgress: async (_workerId: string, payload: {
        taskId: string;
        progressId: string;
        message: string;
        stage?: string;
      }) => {
        reported.push(payload);
      },
    };
    const event = {
      type: "progress_reported",
      taskId: "task-1",
      payload: {
        progressId: "progress-worktree-prepared",
        message: "worktree prepared",
        stage: "worktree_prepared",
      },
    };

    await reportWorkerEventBestEffort(client, "worker-1", event);
    await reportWorkerEventBestEffort(client, "worker-1", event);

    expect(reported).toEqual([
      {
        taskId: "task-1",
        progressId: "progress-worktree-prepared",
        message: "worktree prepared",
        stage: "worktree_prepared",
      },
      {
        taskId: "task-1",
        progressId: "progress-worktree-prepared",
        message: "worktree prepared",
        stage: "worktree_prepared",
      },
    ]);
  });
});
