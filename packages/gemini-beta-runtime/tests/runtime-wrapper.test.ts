import { afterEach, describe, expect, it } from "vitest";

import { prepareTaskWorktree, safeTaskDirName } from "../src/runtime/task-worktree.js";
import { createDispatcherClient, runWorkerDaemon, runWorkerDaemonCycle } from "../src/runtime/worker-daemon.js";
import { buildGeminiLaunchCommand } from "../src/runtime/run-worker-assignment.js";

const originalEnv = {
  FORGEFLOW_GEMINI_BIN: process.env.FORGEFLOW_GEMINI_BIN,
  FORGEFLOW_GEMINI_MODEL: process.env.FORGEFLOW_GEMINI_MODEL,
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

describe("gemini runtime core wrappers", () => {
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

  it("builds gemini launch command through the thin wrapper", () => {
    process.env.FORGEFLOW_GEMINI_BIN = "node";
    process.env.FORGEFLOW_GEMINI_MODEL = "gemini-test";

    const command = buildGeminiLaunchCommand({
      assignment: {
        taskId: "task-1",
        branchName: "ai/gemini/task-1",
        defaultBranch: "main",
        pool: "gemini",
        repo: "owner/repo",
      },
      prompt: "Do the work.",
      worktreeDir: "/tmp/worktree",
    });

    expect(command).toEqual({
      provider: "gemini",
      argv: ["node", "-m", "gemini-test", "-p", "Do the work."],
      cwd: "/tmp/worktree",
    });
  });
});
