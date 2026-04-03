import { describe, expect, it } from "vitest";

import { createGeminiRuntime } from "../../../src/modules/runtime/gemini.js";

describe("Gemini runtime", () => {
  it("uses gemini-2.5-pro for worker tasks", () => {
    const runtime = createGeminiRuntime();
    const launch = runtime.launchTask({
      taskId: "task-3",
      prompt: "Build Vue login page",
      mode: "run",
      worktreeDir: ".worktrees/task-3",
    });

    expect(runtime.model).toBe("gemini-2.5-pro");
    expect(launch.argv).toEqual([
      "gemini",
      "-m",
      "gemini-2.5-pro",
      "-p",
      "Build Vue login page",
    ]);
    expect(launch.cwd).toBe(".worktrees/task-3");
  });

  it("supports run mode only and normalizes results", () => {
    const runtime = createGeminiRuntime();
    const result = runtime.collectResult({
      taskId: "task-3",
      mode: "run",
      output: "ui done",
    });

    expect(runtime.supportsMode("run")).toBe(true);
    expect(runtime.supportsMode("review")).toBe(false);
    expect(result).toEqual({
      provider: "gemini",
      taskId: "task-3",
      mode: "run",
      output: "ui done",
    });
  });
});
