import { describe, expect, it } from "vitest";

import { createCodexRuntime } from "../../../src/modules/runtime/codex.js";

describe("Codex runtime", () => {
  it("uses GPT-5.4 for control tasks", () => {
    const runtime = createCodexRuntime("control");
    const launch = runtime.launchTask({
      taskId: "task-1",
      prompt: "Plan the work",
      mode: "run",
      worktreeDir: ".worktrees/task-1",
    });

    expect(runtime.model).toBe("GPT-5.4");
    expect(launch.argv).toEqual([
      "codex",
      "exec",
      "-m",
      "GPT-5.4",
      "--sandbox",
      "workspace-write",
      "Plan the work",
    ]);
    expect(launch.cwd).toBe(".worktrees/task-1");
  });

  it("uses the default local codex model for worker tasks and supports review mode", () => {
    const runtime = createCodexRuntime("worker");
    const launch = runtime.launchTask({
      taskId: "task-2",
      prompt: "Implement auth API",
      mode: "review",
      worktreeDir: ".worktrees/task-2",
    });

    expect(runtime.model).toBe("default");
    expect(launch.argv).toEqual([
      "codex",
      "exec",
      "--sandbox",
      "workspace-write",
      "--mode",
      "review",
      "Implement auth API",
    ]);
    expect(runtime.supportsMode("review")).toBe(true);
  });

  it("builds verification commands and normalizes results", () => {
    const runtime = createCodexRuntime("worker");
    const verification = runtime.runVerification({
      cwd: ".worktrees/task-2",
      commands: ["pnpm test", "pnpm typecheck"],
    });
    const result = runtime.collectResult({
      taskId: "task-2",
      mode: "run",
      output: "done",
    });

    expect(verification).toEqual([
      { argv: ["zsh", "-lc", "pnpm test"], cwd: ".worktrees/task-2" },
      { argv: ["zsh", "-lc", "pnpm typecheck"], cwd: ".worktrees/task-2" },
    ]);
    expect(result).toEqual({
      provider: "codex",
      taskId: "task-2",
      mode: "run",
      output: "done",
    });
  });
});
