import { afterEach, describe, expect, it } from "vitest";

import { prepareTaskWorktree, safeTaskDirName } from "../src/runtime/task-worktree.js";
import { createDispatcherClient, runWorkerDaemon, runWorkerDaemonCycle } from "../src/runtime/worker-daemon.js";
import { buildCodexLaunchCommand } from "../src/runtime/run-worker-assignment.js";

const originalEnv = {
  FORGEFLOW_CODEX_BIN: process.env.FORGEFLOW_CODEX_BIN,
  FORGEFLOW_CODEX_MODEL: process.env.FORGEFLOW_CODEX_MODEL,
};

function restoreEnv(): void {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe("codex runtime core wrappers", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("keeps the historical runtime exports available", () => {
    expect(typeof createDispatcherClient).toBe("function");
    expect(typeof runWorkerDaemon).toBe("function");
    expect(typeof runWorkerDaemonCycle).toBe("function");
    expect(typeof prepareTaskWorktree).toBe("function");
    expect(safeTaskDirName("task/one")).toBe("task-one");
  });

  it("builds codex launch command through the thin wrapper", () => {
    process.env.FORGEFLOW_CODEX_BIN = "node";
    process.env.FORGEFLOW_CODEX_MODEL = "gpt-5.4-codex";

    const command = buildCodexLaunchCommand({
      assignment: {
        taskId: "task-1",
        branchName: "ai/codex/task-1",
        defaultBranch: "main",
        pool: "codex",
        repo: "owner/repo",
      },
      prompt: "Do the work.",
      worktreeDir: "/tmp/worktree",
    });

    expect(command).toEqual({
      provider: "codex",
      argv: ["node", "exec", "-m", "gpt-5.4-codex", "--sandbox", "workspace-write", "Do the work."],
      cwd: "/tmp/worktree",
    });
  });
});
