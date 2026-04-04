import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { isCliEntrypoint, parseCliArgs, runCli } from "../src/cli.js";

describe("worker-review-orchestrator-cli", () => {
  it("parses the supported commands", () => {
    expect(parseCliArgs(["dispatch", "--dispatcher-url", "http://127.0.0.1:8787", "--input", "dispatch.json", "--target-worker-id", "trae-remote-forgeflow"])).toMatchObject({
      command: "dispatch",
      options: {
        dispatcherUrl: "http://127.0.0.1:8787",
        input: "dispatch.json",
        targetWorkerId: "trae-remote-forgeflow",
      },
    });
    expect(parseCliArgs([
      "dispatch-task",
      "--dispatcher-url",
      "http://127.0.0.1:8787",
      "--repo",
      "TingRuDeng/ForgeFlow",
      "--default-branch",
      "main",
      "--task-id",
      "task-1",
      "--title",
      "Do thing",
      "--pool",
      "trae",
      "--branch-name",
      "ai/trae/task-1",
    ])).toMatchObject({
      command: "dispatch-task",
      options: {
        dispatcherUrl: "http://127.0.0.1:8787",
        repo: "TingRuDeng/ForgeFlow",
        defaultBranch: "main",
        taskId: "task-1",
        title: "Do thing",
        pool: "trae",
        branchName: "ai/trae/task-1",
      },
    });
    expect(parseCliArgs([
      "dispatch-task",
      "--dispatcher-url",
      "http://127.0.0.1:8787",
      "--repo",
      "TingRuDeng/ForgeFlow",
      "--default-branch",
      "main",
      "--task-id",
      "task-1",
      "--title",
      "Do thing",
      "--pool",
      "trae",
      "--branch-name",
      "ai/trae/task-1",
      "--require-existing-worker",
    ])).toMatchObject({
      command: "dispatch-task",
      options: {
        dispatcherUrl: "http://127.0.0.1:8787",
        repo: "TingRuDeng/ForgeFlow",
        defaultBranch: "main",
        taskId: "task-1",
        title: "Do thing",
        pool: "trae",
        branchName: "ai/trae/task-1",
        requireExistingWorker: true,
      },
    });
    expect(parseCliArgs(["continue-task", "--dispatcher-url", "http://127.0.0.1:8787", "--task-id", "dispatch-1:task-1"])).toMatchObject({
      command: "continue-task",
      options: {
        dispatcherUrl: "http://127.0.0.1:8787",
        taskId: "dispatch-1:task-1",
      },
    });
    expect(parseCliArgs(["watch", "--dispatcher-url", "http://127.0.0.1:8787", "--task-id", "dispatch-1:task-1"])).toMatchObject({
      command: "watch",
      options: {
        dispatcherUrl: "http://127.0.0.1:8787",
        taskId: "dispatch-1:task-1",
      },
    });
    expect(parseCliArgs(["decide", "--dispatcher-url", "http://127.0.0.1:8787", "--task-id", "dispatch-1:task-1", "--decision", "merge"])).toMatchObject({
      command: "decide",
      options: {
        dispatcherUrl: "http://127.0.0.1:8787",
        taskId: "dispatch-1:task-1",
        decision: "merge",
      },
    });
    expect(parseCliArgs(["inspect", "--dispatcher-url", "http://127.0.0.1:8787", "--task-id", "dispatch-1:task-1"])).toMatchObject({
      command: "inspect",
      options: {
        dispatcherUrl: "http://127.0.0.1:8787",
        taskId: "dispatch-1:task-1",
      },
    });
  });

  it("parses the watch command with --summary flag", () => {
    expect(parseCliArgs(["watch", "--dispatcher-url", "http://127.0.0.1:8787", "--task-id", "dispatch-1:task-1", "--summary"])).toMatchObject({
      command: "watch",
      options: {
        dispatcherUrl: "http://127.0.0.1:8787",
        taskId: "dispatch-1:task-1",
        summary: true,
      },
    });
  });

  it("routes dispatch output through the injected dependency", async () => {
    const log = vi.fn();
    const runDispatch = vi.fn().mockResolvedValue({
      dispatchId: "dispatch-1",
      taskIds: ["dispatch-1:task-1"],
      assignments: [],
    });

    const result = await runCli(
      ["dispatch", "--dispatcher-url", "http://127.0.0.1:8787", "--input", "-"],
      {
        runDispatch,
        log,
      },
    );

    expect(runDispatch).toHaveBeenCalledWith({
      dispatcherUrl: "http://127.0.0.1:8787",
      input: "-",
      requestTimeoutMs: undefined,
      requireExistingWorker: false,
      targetWorkerId: undefined,
    });
    expect(result).toMatchObject({
      dispatchId: "dispatch-1",
    });
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("passes targetWorkerId through dispatch", async () => {
    const log = vi.fn();
    const runDispatch = vi.fn().mockResolvedValue({
      dispatchId: "dispatch-1",
      taskIds: ["dispatch-1:task-1"],
      assignments: [],
    });

    await runCli(
      [
        "dispatch",
        "--dispatcher-url",
        "http://127.0.0.1:8787",
        "--input",
        "dispatch.json",
        "--target-worker-id",
        "trae-remote-forgeflow",
      ],
      {
        runDispatch,
        log,
      },
    );

    expect(runDispatch).toHaveBeenCalledWith({
      dispatcherUrl: "http://127.0.0.1:8787",
      input: "dispatch.json",
      requestTimeoutMs: undefined,
      requireExistingWorker: false,
      targetWorkerId: "trae-remote-forgeflow",
    });
  });

  it("passes requireExistingWorker through dispatch", async () => {
    const log = vi.fn();
    const runDispatch = vi.fn().mockResolvedValue({
      dispatchId: "dispatch-1",
      taskIds: ["dispatch-1:task-1"],
      assignments: [],
    });

    await runCli(
      [
        "dispatch",
        "--dispatcher-url",
        "http://127.0.0.1:8787",
        "--input",
        "dispatch.json",
        "--require-existing-worker",
      ],
      {
        runDispatch,
        log,
      },
    );

    expect(runDispatch).toHaveBeenCalledWith({
      dispatcherUrl: "http://127.0.0.1:8787",
      input: "dispatch.json",
      requestTimeoutMs: undefined,
      requireExistingWorker: true,
      targetWorkerId: undefined,
    });
  });

  it("builds and dispatches a single task from CLI flags", async () => {
    const log = vi.fn();
    const runDispatch = vi.fn().mockResolvedValue({
      dispatchId: "dispatch-1",
      taskIds: ["dispatch-1:task-1"],
      assignments: [],
    });

    await runCli(
      [
        "dispatch-task",
        "--dispatcher-url",
        "http://127.0.0.1:8787",
        "--repo",
        "TingRuDeng/ForgeFlow",
        "--default-branch",
        "main",
        "--task-id",
        "task-1",
        "--title",
        "Do thing",
        "--pool",
        "trae",
        "--branch-name",
        "ai/trae/task-1",
        "--allowed-paths",
        "docs/**,README.md",
        "--acceptance",
        "pnpm typecheck,git diff --check",
        "--target-worker-id",
        "trae-remote-forgeflow",
      ],
      {
        runDispatch,
        log,
      },
    );

    expect(runDispatch).toHaveBeenCalledWith(expect.objectContaining({
      dispatcherUrl: "http://127.0.0.1:8787",
      input: "-",
      requestTimeoutMs: undefined,
      requireExistingWorker: false,
      targetWorkerId: "trae-remote-forgeflow",
      payload: expect.objectContaining({
        repo: "TingRuDeng/ForgeFlow",
        defaultBranch: "main",
        tasks: [
          expect.objectContaining({
            id: "task-1",
            title: "Do thing",
            pool: "trae",
            branchName: "ai/trae/task-1",
            targetWorkerId: "trae-remote-forgeflow",
          }),
        ],
      }),
    }));
  });

  it("passes requireExistingWorker through dispatch-task", async () => {
    const log = vi.fn();
    const runDispatch = vi.fn().mockResolvedValue({
      dispatchId: "dispatch-1",
      taskIds: ["dispatch-1:task-1"],
      assignments: [],
    });

    await runCli(
      [
        "dispatch-task",
        "--dispatcher-url",
        "http://127.0.0.1:8787",
        "--repo",
        "TingRuDeng/ForgeFlow",
        "--default-branch",
        "main",
        "--task-id",
        "task-1",
        "--title",
        "Do thing",
        "--pool",
        "trae",
        "--branch-name",
        "ai/trae/task-1",
        "--require-existing-worker",
      ],
      {
        runDispatch,
        log,
      },
    );

    expect(runDispatch).toHaveBeenCalledWith({
      dispatcherUrl: "http://127.0.0.1:8787",
      input: "-",
      requestTimeoutMs: undefined,
      requireExistingWorker: true,
      payload: expect.objectContaining({
        repo: "TingRuDeng/ForgeFlow",
        defaultBranch: "main",
      }),
    });
  });

  it("routes continue-task through redrive instead of dispatch", async () => {
    const log = vi.fn();
    const runDispatch = vi.fn();
    const runRedrive = vi.fn().mockResolvedValue({
      originalTaskId: "dispatch-1:task-1",
      newTaskId: "dispatch-2:redrive-abcd1234",
      targetWorkerId: "trae-local-forgeflow",
      failureSummary: "rework: tighten scope",
      continuationMode: "continue",
      continueFromTaskId: "dispatch-1:task-1",
    });

    const result = await runCli(
      ["continue-task", "--dispatcher-url", "http://127.0.0.1:8787", "--task-id", "dispatch-1:task-1"],
      {
        runDispatch,
        runRedrive,
        log,
      },
    );

    expect(runDispatch).not.toHaveBeenCalled();
    expect(runRedrive).toHaveBeenCalledWith({
      dispatcherUrl: "http://127.0.0.1:8787",
      taskId: "dispatch-1:task-1",
    });
    expect(result).toMatchObject({
      originalTaskId: "dispatch-1:task-1",
      newTaskId: "dispatch-2:redrive-abcd1234",
    });
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("routes inspect output through the injected dependency", async () => {
    const log = vi.fn();
    const runInspect = vi.fn().mockResolvedValue({
      taskId: "dispatch-1:task-1",
      task: { id: "dispatch-1:task-1", status: "review" },
      assignment: { taskId: "dispatch-1:task-1" },
      reviews: [],
      pullRequest: null,
      events: [],
      snapshot: {},
    });

    const result = await runCli(
      ["inspect", "--dispatcher-url", "http://127.0.0.1:8787", "--task-id", "dispatch-1:task-1"],
      {
        runInspect,
        log,
      },
    );

    expect(runInspect).toHaveBeenCalledWith({
      dispatcherUrl: "http://127.0.0.1:8787",
      taskId: "dispatch-1:task-1",
      summary: false,
    });
    expect(result).toMatchObject({
      taskId: "dispatch-1:task-1",
    });
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("routes inspect with --summary flag", async () => {
    const log = vi.fn();
    const runInspect = vi.fn().mockResolvedValue({
      taskId: "dispatch-1:task-1",
      status: "review",
      branch: "feature/test",
      repo: "owner/repo",
      workerId: "worker-1",
      latestResultEvidence: { commit: null, pushStatus: null, testOutput: null },
      recentEvents: [],
      reviewState: null,
      pullRequestState: null,
    });

    const result = await runCli(
      ["inspect", "--dispatcher-url", "http://127.0.0.1:8787", "--task-id", "dispatch-1:task-1", "--summary"],
      {
        runInspect,
        log,
      },
    );

    expect(runInspect).toHaveBeenCalledWith({
      dispatcherUrl: "http://127.0.0.1:8787",
      taskId: "dispatch-1:task-1",
      summary: true,
    });
    expect(result).toMatchObject({
      taskId: "dispatch-1:task-1",
      status: "review",
    });
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("routes watch output through the injected dependency", async () => {
    const log = vi.fn();
    const watchTask = vi.fn().mockResolvedValue({
      taskId: "dispatch-1:task-1",
      status: "review",
      attempts: 2,
      elapsedMs: 100,
    });

    const result = await runCli(
      ["watch", "--dispatcher-url", "http://127.0.0.1:8787", "--task-id", "dispatch-1:task-1"],
      {
        watchTask,
        log,
      },
    );

    expect(watchTask).toHaveBeenCalledWith({
      dispatcherUrl: "http://127.0.0.1:8787",
      taskId: "dispatch-1:task-1",
      intervalMs: undefined,
      timeoutMs: undefined,
      summary: false,
    });
    expect(result).toMatchObject({
      taskId: "dispatch-1:task-1",
      status: "review",
    });
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("routes watch with --summary flag", async () => {
    const log = vi.fn();
    const watchTask = vi.fn().mockResolvedValue({
      taskId: "dispatch-1:task-1",
      status: "merged",
      attempts: 3,
      elapsedMs: 150,
    });

    const result = await runCli(
      ["watch", "--dispatcher-url", "http://127.0.0.1:8787", "--task-id", "dispatch-1:task-1", "--summary"],
      {
        watchTask,
        log,
      },
    );

    expect(watchTask).toHaveBeenCalledWith({
      dispatcherUrl: "http://127.0.0.1:8787",
      taskId: "dispatch-1:task-1",
      intervalMs: undefined,
      timeoutMs: undefined,
      summary: true,
    });
    expect(result).toMatchObject({
      taskId: "dispatch-1:task-1",
      status: "merged",
    });
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("recognizes the CLI entrypoint when a symlinked temp path resolves to the real script", () => {
    const actualCliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
    const realpathSpy = vi.spyOn(fs, "realpathSync").mockReturnValue(actualCliPath as ReturnType<typeof fs.realpathSync>);

    expect(isCliEntrypoint("/tmp/worker-review-orchestrator-cli/dist/cli.js")).toBe(true);

    realpathSpy.mockRestore();
  });

  it("returns dry-run result without dispatching when --dry-run is set", async () => {
    const log = vi.fn();
    const runDispatch = vi.fn().mockResolvedValue({
      dispatchId: "dispatch-1",
      taskIds: ["dispatch-1:task-1"],
      assignments: [],
    });

    const result = await runCli(
      [
        "dispatch-task",
        "--dispatcher-url",
        "http://127.0.0.1:8787",
        "--repo",
        "TingRuDeng/ForgeFlow",
        "--default-branch",
        "main",
        "--task-id",
        "task-1",
        "--title",
        "Do thing",
        "--pool",
        "trae",
        "--branch-name",
        "ai/trae/task-1",
        "--dry-run",
      ],
      {
        runDispatch,
        log,
      },
    );

    expect(runDispatch).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      dryRun: true,
      dispatcherUrl: "http://127.0.0.1:8787",
      payload: expect.objectContaining({
        repo: "TingRuDeng/ForgeFlow",
        defaultBranch: "main",
        tasks: [
          expect.objectContaining({
            id: "task-1",
            title: "Do thing",
            pool: "trae",
            branchName: "ai/trae/task-1",
          }),
        ],
      }),
    });
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("parses --worker-prompt-file and --context-markdown-file flags", async () => {
    const log = vi.fn();
    const runDispatch = vi.fn().mockResolvedValue({
      dispatchId: "dispatch-1",
      taskIds: ["dispatch-1:task-1"],
      assignments: [],
    });

    const result = await runCli(
      [
        "dispatch-task",
        "--dispatcher-url",
        "http://127.0.0.1:8787",
        "--repo",
        "TingRuDeng/ForgeFlow",
        "--default-branch",
        "main",
        "--task-id",
        "task-1",
        "--title",
        "Do thing",
        "--pool",
        "trae",
        "--branch-name",
        "ai/trae/task-1",
        "--worker-prompt-file",
        "/path/to/prompt.md",
        "--context-markdown-file",
        "/path/to/context.md",
        "--dry-run",
      ],
      {
        runDispatch,
        log,
      },
    );

    expect(runDispatch).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      dryRun: true,
      dispatcherUrl: "http://127.0.0.1:8787",
      payload: expect.objectContaining({
        repo: "TingRuDeng/ForgeFlow",
        packages: [
          expect.objectContaining({
            workerPrompt: expect.any(String),
            contextMarkdown: expect.any(String),
          }),
        ],
      }),
    });
  });

  it("parses the update command", () => {
    expect(parseCliArgs(["update"])).toMatchObject({
      command: "update",
      options: {},
    });
  });

  it("parses update with --default-branch option", () => {
    expect(parseCliArgs(["update", "--default-branch", "next"])).toMatchObject({
      command: "update",
      options: {
        defaultBranch: "next",
      },
    });
  });

  it("shows help for update --help", async () => {
    const log = vi.fn();

    const result = await runCli(
      ["update", "--help"],
      { log },
    );

    expect(result).toBeNull();
    expect(log).toHaveBeenCalledTimes(1);
    const helpText = log.mock.calls[0][0] as string;
    expect(helpText).toContain("forgeflow-review-orchestrator update");
    expect(helpText).toContain("--default-branch");
    expect(helpText).toContain("@tingrudeng/worker-review-orchestrator-cli");
  });

  it("routes update through the injected dependency", async () => {
    const log = vi.fn();
    const runUpdate = vi.fn().mockResolvedValue({
      packageName: "@tingrudeng/worker-review-orchestrator-cli",
      previousVersion: "0.1.0-beta.4",
      installedVersion: "0.1.0-beta.5",
      performedCommand: "npm install -g @tingrudeng/worker-review-orchestrator-cli@latest",
      stdout: "added 1 package",
      stderr: "",
      message: "Updated the globally installed ForgeFlow review orchestrator CLI.",
    });

    const result = await runCli(
      ["update"],
      { runUpdate, log },
    );

    expect(runUpdate).toHaveBeenCalledWith({ defaultBranch: "latest" });
    expect(result).toMatchObject({
      packageName: "@tingrudeng/worker-review-orchestrator-cli",
    });
    expect(log).toHaveBeenCalledTimes(1);
    const output = log.mock.calls[0][0] as string;
    expect(output).toContain("Previous version: 0.1.0-beta.4");
    expect(output).toContain("Installed version: 0.1.0-beta.5");
    expect(output).toContain("@tingrudeng/worker-review-orchestrator-cli");
    expect(output).toContain("npm install -g");
  });

  it("passes --default-branch to the update handler", async () => {
    const log = vi.fn();
    const runUpdate = vi.fn().mockResolvedValue({
      packageName: "@tingrudeng/worker-review-orchestrator-cli",
      previousVersion: null,
      installedVersion: null,
      performedCommand: "npm install -g @tingrudeng/worker-review-orchestrator-cli@next",
      stdout: "",
      stderr: "",
      message: "Updated the globally installed ForgeFlow review orchestrator CLI.",
    });

    await runCli(
      ["update", "--default-branch", "next"],
      { runUpdate, log },
    );

    expect(runUpdate).toHaveBeenCalledWith({ defaultBranch: "next" });
  });

  it("parses the version command", () => {
    expect(parseCliArgs(["version"])).toMatchObject({
      command: "version",
      options: {},
    });
  });

  it("outputs version for version subcommand", async () => {
    const log = vi.fn();

    const result = await runCli(
      ["version"],
      { log },
    );

    expect(result).toBeNull();
    expect(log).toHaveBeenCalledTimes(1);
    const versionOutput = log.mock.calls[0][0] as string;
    expect(versionOutput).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("passes targetWorkerId through dispatch-task follow-up requests so sticky-worker validation can run", async () => {
    const log = vi.fn();
    const runDispatch = vi.fn().mockResolvedValue({
      dispatchId: "dispatch-1",
      taskIds: ["dispatch-1:task-1"],
      assignments: [],
    });

    await runCli(
      [
        "dispatch-task",
        "--dispatcher-url",
        "http://127.0.0.1:8787",
        "--repo",
        "TingRuDeng/ForgeFlow",
        "--default-branch",
        "main",
        "--task-id",
        "task-1",
        "--title",
        "Test task",
        "--pool",
        "trae",
        "--branch-name",
        "ai/trae/task-1",
        "--follow-up-of-task-id",
        "dispatch-1:task-source",
        "--target-worker-id",
        "trae-remote-forgeflow",
      ],
      {
        runDispatch,
        log,
      },
    );

    expect(runDispatch).toHaveBeenCalledWith(expect.objectContaining({
      targetWorkerId: "trae-remote-forgeflow",
      followUpOfTaskId: "dispatch-1:task-source",
    }));
  });

  it("passes strict task spec fields through dispatch-task", async () => {
    const log = vi.fn();
    const runDispatch = vi.fn().mockResolvedValue({
      dispatchId: "dispatch-1",
      taskIds: ["dispatch-1:task-1"],
      assignments: [],
    });

    await runCli(
      [
        "dispatch-task",
        "--dispatcher-url",
        "http://127.0.0.1:8787",
        "--repo",
        "TingRuDeng/ForgeFlow",
        "--default-branch",
        "main",
        "--task-id",
        "task-1",
        "--title",
        "Strict task",
        "--pool",
        "trae",
        "--branch-name",
        "ai/trae/task-1",
        "--strict-task-spec",
        "--goal",
        "Tighten task prompt quality",
        "--source-of-truth",
        "prompts/dispatch-task-template.md,skills/worker-review-orchestrator/SKILL.md",
        "--required-changes",
        "add strict validation,build structured context",
        "--non-goals",
        "do not change runtime",
        "--must-preserve",
        "existing dispatch behavior stays additive",
      ],
      { runDispatch, log },
    );

    expect(runDispatch).toHaveBeenCalled();
    const firstCall = runDispatch.mock.calls[0]?.[0] as { payload?: { packages?: Array<{ contextMarkdown?: string }> } };
    expect(firstCall?.payload?.packages?.[0]?.contextMarkdown).toContain("# Goal");
    expect(firstCall?.payload?.packages?.[0]?.contextMarkdown).toContain("# Source of Truth");
  });
});
