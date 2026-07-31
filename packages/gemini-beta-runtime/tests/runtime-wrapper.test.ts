import { afterEach, describe, expect, it } from "vitest";

import { prepareTaskWorktree, safeTaskDirName } from "../src/runtime/task-worktree.js";
import { createDispatcherClient, runWorkerDaemon, runWorkerDaemonCycle } from "../src/runtime/worker-daemon.js";
import { buildGeminiLaunchCommand } from "../src/runtime/run-worker-assignment.js";
import { matchesGeminiWorkerCommand } from "../src/start-worker.js";

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
    expect(safeTaskDirName("task/one")).toMatch(/^task-one-[0-9a-f]{12}$/);
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

  it("matches managed workers only when the execution policy id is current", () => {
    const base = {
      repoDir: "/tmp/repo",
      dispatcherUrl: "http://127.0.0.1:8787",
      workerId: "gemini-1",
      pool: "gemini",
      geminiBin: "gemini",
    };
    const trustedCommand = [
      "node dist/runtime/worker.js",
      "--repo-dir /tmp/repo",
      "--dispatcher-url http://127.0.0.1:8787",
      "--worker-id gemini-1",
      "--pool gemini",
      "--gemini-bin gemini",
    ].join(" ");
    const isolatedCommand = `${trustedCommand} --execution-policy-id sha256:current`;

    expect(matchesGeminiWorkerCommand(trustedCommand, {
      ...base,
      executionPolicyId: "",
    })).toBe(true);
    expect(matchesGeminiWorkerCommand(isolatedCommand, {
      ...base,
      executionPolicyId: "sha256:current",
    })).toBe(true);
    expect(matchesGeminiWorkerCommand(isolatedCommand, {
      ...base,
      executionPolicyId: "sha256:stale",
    })).toBe(false);
  });
});
