import { afterEach, describe, expect, it, vi } from "vitest";

const prepareTaskWorktreeMock = vi.fn((_repoDir: string, task: { taskId?: string }) => (
  `/tmp/project/.worktrees/${task?.taskId || "task-1"}`
));
const safeTaskDirNameMock = vi.fn((value: string) => value.replace(/[^a-z0-9._-]+/gi, "-"));
const checkArtifactReviewabilityMock = vi.fn();

vi.mock("../../src/runtime/task-worktree.js", () => ({
  prepareTaskWorktree: prepareTaskWorktreeMock,
  safeTaskDirName: safeTaskDirNameMock,
}));

vi.mock("../../src/runtime/trae-automation-artifact-checks.js", () => ({
  checkArtifactReviewability: checkArtifactReviewabilityMock,
}));

vi.mock("node:fs", () => ({
  default: {
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
}));

describe("runtime/worker", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    prepareTaskWorktreeMock.mockClear();
    safeTaskDirNameMock.mockClear();
    checkArtifactReviewabilityMock.mockReset();
    checkArtifactReviewabilityMock.mockReturnValue({
      reviewable: false,
      reason: null,
      evidence: {
        worktreeExists: false,
        branchMatches: false,
        hasChanges: false,
        allChangesInScope: false,
        remoteVerified: false,
        branchName: null,
        commitSha: null,
        filesChanged: [],
        outOfScopeFiles: [],
        uncommittedFiles: [],
      },
    });
  });

  checkArtifactReviewabilityMock.mockReturnValue({
    reviewable: false,
    reason: null,
    evidence: {
      worktreeExists: false,
      branchMatches: false,
      hasChanges: false,
      allChangesInScope: false,
      remoteVerified: false,
      branchName: null,
      commitSha: null,
      filesChanged: [],
      outOfScopeFiles: [],
      uncommittedFiles: [],
    },
  });

  it("registers, materializes a worktree, and submits a parsed result", async () => {
    const dispatcherClient = {
      register: vi.fn(async () => ({})),
      fetchTask: vi.fn(async () => ({
        status: "task",
        task: {
          task_id: "task-1",
          repo: "repo",
          branch: "feature/runtime",
          default_branch: "main",
          scope: ["src"],
          acceptance: ["pnpm test"],
          constraints: ["no docs"],
          prompt: "Implement the runtime port",
          chat_mode: "new_chat",
        },
      })),
      startTask: vi.fn(async () => ({})),
      reportProgress: vi.fn(async () => ({})),
      submitResult: vi.fn(async () => ({})),
      heartbeat: vi.fn(async () => ({})),
    };
    const automationClient = {
      ready: vi.fn(async () => ({ ready: true })),
      prepareSession: vi.fn(async () => ({ data: { sessionId: "session-001" } })),
      sendChat: vi.fn(async () => ({
        response: {
          text: [
            "## 任务完成",
            "- 结果: 成功",
            "- 任务ID: task-1",
            "- 修改文件: src/runtime/worker.ts, src/runtime/task-worktree.ts",
            "- 测试结果: pnpm test",
            "- 风险: 无",
            "- GitHub 证据:",
            "  - branch: codex/trae-beta-self-contained-runtime",
            "  - commit: abc123",
            "  - push: 成功",
            "  - push_error: 无",
            "  - PR: 42",
            "  - PR URL: https://example.com/pr/42",
            "- 备注: all good",
          ].join("\n"),
        },
      })),
      releaseSession: vi.fn(async () => ({ data: { sessionId: "session-001", released: true } })),
    };
    const launchTrae = vi.fn(async () => ({ reusedExisting: false }));

    const { createTraeAutomationWorkerRuntime } = await import("../../src/runtime/worker.js");
    const runtime = createTraeAutomationWorkerRuntime({
      dispatcherClient: dispatcherClient as never,
      automationClient: automationClient as never,
      workerId: "trae-remote",
      repoDir: "/tmp/project",
      traeBin: "/Applications/Trae CN.app",
      remoteDebuggingPort: 9222,
      logger: { warn: vi.fn(), log: vi.fn() },
      launchTrae,
      sleep: vi.fn(async () => undefined),
      setIntervalImpl: vi.fn(() => ({}) as never),
      clearIntervalImpl: vi.fn(),
    });

    await runtime.register();
    const result = await runtime.runOnce();

    expect(dispatcherClient.register).toHaveBeenCalledWith({
      workerId: "trae-remote",
      pool: "trae",
      repoDir: "/tmp/project",
      labels: ["automation-gateway"],
    });
    expect(automationClient.ready).toHaveBeenCalledWith({
      discovery: {
        titleContains: ["project"],
      },
    });
    expect(prepareTaskWorktreeMock).toHaveBeenCalledWith("/tmp/project", {
      taskId: "task-1",
      branchName: "feature/runtime",
      defaultBranch: "main",
    }, {
      allowReuse: true,
    });
    expect(dispatcherClient.startTask).toHaveBeenCalledWith("trae-remote", "task-1");
    expect(dispatcherClient.reportProgress).toHaveBeenCalledWith("task-1", "Trae automation worker started task", "trae-remote");
    expect(automationClient.ready).toHaveBeenNthCalledWith(2, {
      discovery: expect.objectContaining({
        titleContains: expect.arrayContaining(["task-1"]),
      }),
    });
    expect(dispatcherClient.reportProgress).toHaveBeenCalledWith(
      "task-1",
      "Trae automation gateway is waiting for task target readiness",
      "trae-remote",
    );
    expect(automationClient.sendChat).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "session-001",
      prepare: false,
      chatMode: "new_chat",
      responseRequiredPrefix: "任务完成",
    }));
    expect(automationClient.releaseSession).toHaveBeenCalledWith("session-001");
    const sendChatCalls = automationClient.sendChat.mock.calls as Array<Array<{ content?: string }>>;
    const promptContent = sendChatCalls[0]?.[0]?.content || "";
    expect(promptContent).toContain("执行上下文预检要求：");
    expect(promptContent).toContain("在进行任何文件编辑之前，必须先完成执行上下文预检证明");
    expect(promptContent).toContain("报告当前仓库路径");
    expect(promptContent).toContain("报告当前分支");
    expect(promptContent).toContain("git status --short");
    expect(promptContent).toContain("说明：以上信息仅供了解当前工作环境，不是失败条件");
    expect(promptContent).toContain("先完成执行上下文预检证明");
    expect(dispatcherClient.submitResult).toHaveBeenCalledWith({
      taskId: "task-1",
      status: "review_ready",
      summary: "all good",
      testOutput: "pnpm test",
      risks: [],
      filesChanged: ["src/runtime/worker.ts", "src/runtime/task-worktree.ts"],
      github: {
        branchName: "codex/trae-beta-self-contained-runtime",
        commitSha: "abc123",
        pushStatus: "success",
        pushError: null,
        prNumber: 42,
        prUrl: "https://example.com/pr/42",
      },
      evidence: {
        blockers: [],
        findings: [],
        artifacts: {
          source: "chat_completion",
          conclusionType: "repo_fix",
          branchName: "codex/trae-beta-self-contained-runtime",
          commitSha: "abc123",
          pushStatus: "success",
          filesChanged: "src/runtime/worker.ts,src/runtime/task-worktree.ts",
        },
      },
    });
    expect(result).toEqual({
      status: "review_ready",
      taskId: "task-1",
      responseText: expect.stringContaining("## 任务完成"),
    });

    runtime.stop();
  });

  it("submits a failed result when workspace preparation fails before start-task", async () => {
    prepareTaskWorktreeMock.mockImplementationOnce(() => {
      throw new Error("branch feature/runtime is already checked out at /tmp/project/.worktrees/dispatch-178");
    });

    const dispatcherClient = {
      register: vi.fn(async () => ({})),
      fetchTask: vi.fn(async () => ({
        status: "task",
        task: {
          task_id: "task-workspace-fail",
          repo: "repo",
          branch: "feature/runtime",
          default_branch: "main",
          scope: ["src/**"],
          acceptance: ["pnpm test"],
          constraints: [],
          prompt: "workspace fail case",
          chat_mode: "new_chat",
        },
      })),
      startTask: vi.fn(async () => ({})),
      reportProgress: vi.fn(async () => ({})),
      submitResult: vi.fn(async () => ({})),
      heartbeat: vi.fn(async () => ({})),
    };
    const automationClient = {
      ready: vi.fn(async () => ({ ready: true })),
      prepareSession: vi.fn(async () => ({ data: { sessionId: "session-001" } })),
      sendChat: vi.fn(async () => ({ response: { text: "" } })),
      releaseSession: vi.fn(async () => ({ data: { sessionId: "session-001", released: true } })),
    };

    const { createTraeAutomationWorkerRuntime } = await import("../../src/runtime/worker.js");
    const runtime = createTraeAutomationWorkerRuntime({
      dispatcherClient: dispatcherClient as never,
      automationClient: automationClient as never,
      workerId: "trae-local",
      repoDir: "/tmp/project",
      logger: { warn: vi.fn(), log: vi.fn() },
      sleep: vi.fn(async () => undefined),
      setIntervalImpl: vi.fn(() => ({}) as never),
      clearIntervalImpl: vi.fn(),
    });

    const result = await runtime.runOnce();

    expect(dispatcherClient.startTask).not.toHaveBeenCalled();
    expect(dispatcherClient.submitResult).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "task-workspace-fail",
      status: "failed",
      summary: expect.stringContaining("workspace_prepare_failed"),
    }));
    expect(dispatcherClient.reportProgress).toHaveBeenCalledWith(
      "task-workspace-fail",
      expect.stringContaining("Task bootstrap failed: workspace_prepare_failed"),
      "trae-local",
    );
    expect(result).toEqual({
      status: "failed",
      taskId: "task-workspace-fail",
      error: expect.stringContaining("workspace_prepare_failed"),
    });

    runtime.stop();
  });

  it("emits debug logs when debug mode is enabled", async () => {
    const dispatcherClient = {
      register: vi.fn(async () => ({})),
      fetchTask: vi.fn(async () => ({ status: "no_task" })),
      startTask: vi.fn(async () => ({})),
      reportProgress: vi.fn(async () => ({})),
      submitResult: vi.fn(async () => ({})),
      heartbeat: vi.fn(async () => ({})),
    };
    const automationClient = {
      ready: vi.fn(async () => ({ ready: true })),
      prepareSession: vi.fn(async () => ({ data: { sessionId: "session-001" } })),
      sendChat: vi.fn(async () => ({ response: { text: "" } })),
      releaseSession: vi.fn(async () => ({ data: { sessionId: "session-001", released: true } })),
    };
    const logger = { warn: vi.fn(), log: vi.fn() };

    const { createTraeAutomationWorkerRuntime } = await import("../../src/runtime/worker.js");
    const runtime = createTraeAutomationWorkerRuntime({
      dispatcherClient: dispatcherClient as never,
      automationClient: automationClient as never,
      workerId: "trae-debug",
      repoDir: "/tmp/project",
      logger,
      debug: true,
      sleep: vi.fn(async () => undefined),
      setIntervalImpl: vi.fn(() => ({}) as never),
      clearIntervalImpl: vi.fn(),
    });

    await runtime.register();
    await runtime.runOnce();

    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining("\"event\":\"worker.register.start\""));
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining("\"event\":\"worker.fetch_task.no_task\""));
    runtime.stop();
  });

  it("polls session status after a soft timeout and extracts stored response", async () => {
    const dispatcherClient = {
      register: vi.fn(async () => ({})),
      fetchTask: vi.fn(async () => ({
        status: "task",
        task: {
          task_id: "task-2",
          repo: "repo",
          branch: "feature/runtime-timeout",
          default_branch: "main",
          scope: ["src/**"],
          acceptance: ["pnpm test"],
          constraints: [],
          prompt: "Recover after soft timeout",
          chat_mode: "new_chat",
        },
      })),
      startTask: vi.fn(async () => ({})),
      reportProgress: vi.fn(async () => ({})),
      submitResult: vi.fn(async () => ({})),
      heartbeat: vi.fn(async () => ({})),
    };
    let chatCallCount = 0;
    const automationClient = {
      ready: vi.fn(async () => ({ ready: true })),
      prepareSession: vi.fn(async () => ({ data: { sessionId: "session-123" } })),
      getSession: vi.fn(async () => ({
        data: {
          status: "completed",
          responseText: [
            "## 任务完成",
            "- 结果: 成功",
            "- 任务ID: task-2",
            "- 修改文件: src/recovered.ts",
            "- 测试结果: cached replay",
            "- 风险: 无",
            "- GitHub 证据:",
            "  - branch: feature/runtime-timeout",
            "  - commit: abc124",
            "  - push: 成功",
            "  - push_error: 无",
            "  - PR: 无",
            "  - PR URL: 无",
            "- 备注: replayed",
          ].join("\n"),
        },
      })),
      sendChat: vi.fn(async () => {
        chatCallCount += 1;
        throw new Error("request timeout: /v1/chat");
      }),
      releaseSession: vi.fn(async () => ({ data: { sessionId: "session-123", released: true } })),
    };
    const launchTrae = vi.fn(async () => ({ reusedExisting: false }));

    const { createTraeAutomationWorkerRuntime } = await import("../../src/runtime/worker.js");
    const runtime = createTraeAutomationWorkerRuntime({
      dispatcherClient: dispatcherClient as never,
      automationClient: automationClient as never,
      workerId: "trae-remote",
      repoDir: "/tmp/project",
      logger: { warn: vi.fn(), log: vi.fn() },
      launchTrae,
      sleep: vi.fn(async () => undefined),
      setIntervalImpl: vi.fn(() => ({}) as never),
      clearIntervalImpl: vi.fn(),
    });

    const result = await runtime.runOnce();

    expect(automationClient.prepareSession).toHaveBeenCalledWith({
      discovery: expect.objectContaining({
        titleContains: expect.arrayContaining(["task-2"]),
      }),
      chatMode: "new_chat",
    });
    expect(automationClient.getSession).toHaveBeenCalledWith("session-123");
    expect(automationClient.sendChat).toHaveBeenCalledTimes(1);
    expect(automationClient.sendChat).toHaveBeenNthCalledWith(1, expect.objectContaining({
      sessionId: "session-123",
      prepare: false,
      chatMode: "new_chat",
      responseRequiredPrefix: "任务完成",
    }));
    expect(dispatcherClient.reportProgress).toHaveBeenCalledWith(
      "task-2",
      "Session completed, extracting stored response",
      "trae-remote"
    );
    expect(automationClient.releaseSession).toHaveBeenCalledWith("session-123");
    expect(result).toEqual({
      status: "review_ready",
      taskId: "task-2",
      responseText: expect.stringContaining("## 任务完成"),
    });

    runtime.stop();
  });

  it("extends an active session in five-minute chunks before extracting the final response", async () => {
    const dispatcherClient = {
      register: vi.fn(async () => ({})),
      fetchTask: vi.fn(async () => ({
        status: "task",
        task: {
          task_id: "task-2-active",
          repo: "repo",
          branch: "feature/runtime-timeout-active",
          default_branch: "main",
          scope: ["src/**"],
          acceptance: ["pnpm test"],
          constraints: [],
          prompt: "Recover after an active soft timeout",
          chat_mode: "new_chat",
        },
      })),
      startTask: vi.fn(async () => ({})),
      reportProgress: vi.fn(async () => ({})),
      submitResult: vi.fn(async () => ({})),
      heartbeat: vi.fn(async () => ({})),
    };
    let sessionCallCount = 0;
    const runningSession = {
      data: {
        status: "running",
        lastActivityAt: new Date("2026-04-03T00:29:00.000Z").toISOString(),
      },
    };
    const completedSession = {
      data: {
        status: "completed",
        responseText: [
          "## 任务完成",
          "- 结果: 成功",
          "- 任务ID: task-2-active",
          "- 修改文件: src/recovered.ts",
          "- 测试结果: cached replay",
          "- 风险: 无",
          "- GitHub 证据:",
          "  - branch: feature/runtime-timeout-active",
          "  - commit: abc124",
          "  - push: 成功",
          "  - push_error: 无",
          "  - PR: 无",
          "  - PR URL: 无",
          "- 备注: replayed",
        ].join("\n"),
      },
    };
    const automationClient = {
      ready: vi.fn(async () => ({ ready: true })),
      prepareSession: vi.fn(async () => ({ data: { sessionId: "session-active" } })),
      getSession: vi.fn(async () => {
        sessionCallCount += 1;
        return sessionCallCount >= 3 ? completedSession : runningSession;
      }),
      sendChat: vi.fn(async () => {
        throw new Error("request timeout: /v1/chat");
      }),
      releaseSession: vi.fn(async () => ({ data: { sessionId: "session-active", released: true } })),
    };
    const launchTrae = vi.fn(async () => ({ reusedExisting: false }));
    const nowValues = [
      0,
      31 * 60 * 1000,
      31 * 60 * 1000,
      37 * 60 * 1000,
      37 * 60 * 1000,
      43 * 60 * 1000,
      43 * 60 * 1000,
      49 * 60 * 1000,
      49 * 60 * 1000,
      55 * 60 * 1000,
      55 * 60 * 1000,
    ];
    let nowIndex = 0;
    vi.spyOn(Date, "now").mockImplementation(() => {
      const value = nowValues[Math.min(nowIndex, nowValues.length - 1)];
      nowIndex += 1;
      return value;
    });

    const { createTraeAutomationWorkerRuntime } = await import("../../src/runtime/worker.js");
    const runtime = createTraeAutomationWorkerRuntime({
      dispatcherClient: dispatcherClient as never,
      automationClient: automationClient as never,
      workerId: "trae-remote",
      repoDir: "/tmp/project",
      logger: { warn: vi.fn(), log: vi.fn() },
      launchTrae,
      sleep: vi.fn(async () => undefined),
      setIntervalImpl: vi.fn(() => ({}) as never),
      clearIntervalImpl: vi.fn(),
    });

    const result = await runtime.runOnce();

    expect(automationClient.sendChat).toHaveBeenCalledTimes(1);
    expect(automationClient.getSession).toHaveBeenCalledTimes(3);
    expect(dispatcherClient.reportProgress).toHaveBeenCalledWith(
      "task-2-active",
      "Session still active, extending soft timeout by 5 minutes",
      "trae-remote"
    );
    expect(dispatcherClient.reportProgress).toHaveBeenCalledWith(
      "task-2-active",
      "Session completed, extracting stored response",
      "trae-remote"
    );
    expect(automationClient.releaseSession).toHaveBeenCalledWith("session-active");
    expect(result).toEqual({
      status: "review_ready",
      taskId: "task-2-active",
      responseText: expect.stringContaining("## 任务完成"),
    });

    runtime.stop();
  });

  it("fails when an active session keeps running past the sixty-minute hard cap", async () => {
    const dispatcherClient = {
      register: vi.fn(async () => ({})),
      fetchTask: vi.fn(async () => ({
        status: "task",
        task: {
          task_id: "task-2-hard-cap",
          repo: "repo",
          branch: "feature/runtime-timeout-cap",
          default_branch: "main",
          scope: ["src/**"],
          acceptance: ["pnpm test"],
          constraints: [],
          prompt: "Fail after the hard cap",
          chat_mode: "new_chat",
        },
      })),
      startTask: vi.fn(async () => ({})),
      reportProgress: vi.fn(async () => ({})),
      submitResult: vi.fn(async () => ({})),
      heartbeat: vi.fn(async () => ({})),
    };
    const automationClient = {
      ready: vi.fn(async () => ({ ready: true })),
      prepareSession: vi.fn(async () => ({ data: { sessionId: "session-hard-cap" } })),
      getSession: vi.fn(async () => ({
        data: {
          status: "running",
          lastActivityAt: new Date("2026-04-03T00:59:00.000Z").toISOString(),
        },
      })),
      sendChat: vi.fn(async () => {
        throw new Error("request timeout: /v1/chat");
      }),
      releaseSession: vi.fn(async () => ({ data: { sessionId: "session-hard-cap", released: true } })),
    };
    const launchTrae = vi.fn(async () => ({ reusedExisting: false }));
    const nowValues = [
      0,
      31 * 60 * 1000,
      31 * 60 * 1000,
      37 * 60 * 1000,
      37 * 60 * 1000,
      43 * 60 * 1000,
      43 * 60 * 1000,
      49 * 60 * 1000,
      49 * 60 * 1000,
      55 * 60 * 1000,
      55 * 60 * 1000,
      61 * 60 * 1000,
      61 * 60 * 1000,
    ];
    let nowIndex = 0;
    vi.spyOn(Date, "now").mockImplementation(() => {
      const value = nowValues[Math.min(nowIndex, nowValues.length - 1)];
      nowIndex += 1;
      return value;
    });

    const { createTraeAutomationWorkerRuntime } = await import("../../src/runtime/worker.js");
    const runtime = createTraeAutomationWorkerRuntime({
      dispatcherClient: dispatcherClient as never,
      automationClient: automationClient as never,
      workerId: "trae-remote",
      repoDir: "/tmp/project",
      logger: { warn: vi.fn(), log: vi.fn() },
      launchTrae,
      sleep: vi.fn(async () => undefined),
      setIntervalImpl: vi.fn(() => ({}) as never),
      clearIntervalImpl: vi.fn(),
    });

    const result = await runtime.runOnce();

    expect(automationClient.sendChat).toHaveBeenCalledTimes(1);
    expect(automationClient.getSession).toHaveBeenCalled();
    expect(dispatcherClient.submitResult).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "task-2-hard-cap",
      status: "failed",
      summary: "Hard timeout exceeded",
    }));
    expect(automationClient.releaseSession).toHaveBeenCalledWith("session-hard-cap");
    expect(result).toEqual({
      status: "failed",
      taskId: "task-2-hard-cap",
      error: "Hard timeout exceeded",
    });

    runtime.stop();
  });

  it("reports an explicit recovery error when chat times out without sessionId", async () => {
    const dispatcherClient = {
      register: vi.fn(async () => ({})),
      fetchTask: vi.fn(async () => ({
        status: "task",
        task: {
          task_id: "task-timeout-no-session",
          repo: "repo",
          branch: "feature/runtime-timeout-no-session",
          default_branch: "main",
          scope: ["src/**"],
          acceptance: ["pnpm test"],
          constraints: [],
          prompt: "Handle timeout without session id",
          chat_mode: "new_chat",
        },
      })),
      startTask: vi.fn(async () => ({})),
      reportProgress: vi.fn(async () => ({})),
      submitResult: vi.fn(async () => ({})),
      heartbeat: vi.fn(async () => ({})),
    };
    const automationClient = {
      ready: vi.fn(async () => ({ ready: true })),
      prepareSession: vi.fn(async () => ({ data: {} })),
      sendChat: vi.fn(async () => {
        throw new Error("request timeout: /v1/chat");
      }),
      releaseSession: vi.fn(async () => ({})),
    };
    const launchTrae = vi.fn(async () => ({ reusedExisting: false }));

    const { createTraeAutomationWorkerRuntime } = await import("../../src/runtime/worker.js");
    const runtime = createTraeAutomationWorkerRuntime({
      dispatcherClient: dispatcherClient as never,
      automationClient: automationClient as never,
      workerId: "trae-remote",
      repoDir: "/tmp/project",
      logger: { warn: vi.fn(), log: vi.fn() },
      launchTrae,
      sleep: vi.fn(async () => undefined),
      setIntervalImpl: vi.fn(() => ({}) as never),
      clearIntervalImpl: vi.fn(),
    });

    const result = await runtime.runOnce();

    expect(dispatcherClient.reportProgress).toHaveBeenCalledWith(
      "task-timeout-no-session",
      "Chat timeout but session id is missing; cannot poll session status",
      "trae-remote",
    );
    expect(dispatcherClient.submitResult).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "task-timeout-no-session",
      status: "failed",
      summary: expect.stringContaining("missing sessionId"),
    }));
    expect(result).toEqual({
      status: "failed",
      taskId: "task-timeout-no-session",
      error: expect.stringContaining("missing sessionId"),
    });
    expect(automationClient.releaseSession).not.toHaveBeenCalled();

    runtime.stop();
  });

  it("includes task-specific discovery hints from the materialized worktree", async () => {
    const dispatcherClient = {
      register: vi.fn(async () => ({})),
      fetchTask: vi.fn(async () => ({
        status: "task",
        task: {
          task_id: "dispatch-200:task-discovery",
          repo: "repo",
          branch: "feature/task-discovery",
          default_branch: "main",
          scope: ["docs/**"],
          acceptance: ["git diff --check"],
          constraints: [],
          prompt: "Discovery hint smoke",
          chat_mode: "new_chat",
        },
      })),
      startTask: vi.fn(async () => ({})),
      reportProgress: vi.fn(async () => ({})),
      submitResult: vi.fn(async () => ({})),
      heartbeat: vi.fn(async () => ({})),
    };
    const automationClient = {
      ready: vi.fn(async () => ({ data: { ready: true } })),
      prepareSession: vi.fn(async () => ({ data: { sessionId: "session-discovery" } })),
      sendChat: vi.fn(async () => ({
        data: {
          response: {
            text: [
              "## 任务完成",
              "- 结果: 成功",
              "- 任务ID: dispatch-200:task-discovery",
              "- 修改文件: docs/smoke.md",
              "- 测试结果: git diff --check",
              "- 风险: 无",
              "- GitHub 证据:",
              "  - branch: feature/task-discovery",
              "  - commit: abc123",
              "  - push: success",
              "  - push_error: 无",
              "- 备注: 完成",
            ].join("\n"),
          },
        },
      })),
      getSession: vi.fn(async () => ({ data: { status: "completed" } })),
      releaseSession: vi.fn(async () => ({})),
    };
    const prepareTaskWorktreeMock = vi.fn(() => "/tmp/project/.worktrees/dispatch-200-task-discovery");

    const { createTraeAutomationWorkerRuntime } = await import("../../src/runtime/worker.js");
    const runtime = createTraeAutomationWorkerRuntime({
      dispatcherClient,
      automationClient,
      workerId: "trae-remote",
      repoDir: "/tmp/project",
      logger: { warn: vi.fn(), log: vi.fn() },
      sleep: vi.fn(async () => undefined),
      setIntervalImpl: vi.fn(() => ({}) as never),
      clearIntervalImpl: vi.fn(),
      prepareTaskWorktree: prepareTaskWorktreeMock,
    } as any);

    await runtime.runOnce();

    expect(automationClient.prepareSession).toHaveBeenCalledWith(expect.objectContaining({
      discovery: {
        titleContains: expect.arrayContaining(["dispatch-200-task-discovery"]),
      },
    }));
    expect(automationClient.sendChat).toHaveBeenCalledWith(expect.objectContaining({
      discovery: {
        titleContains: expect.arrayContaining(["dispatch-200-task-discovery"]),
      },
    }));
  });

  it("salvages reviewable remote artifacts after timeout recovery fails", async () => {
    checkArtifactReviewabilityMock.mockReturnValue({
      reviewable: true,
      reason: "Artifact is reviewable",
      evidence: {
        worktreeExists: true,
        branchMatches: true,
        hasChanges: true,
        allChangesInScope: true,
        remoteVerified: true,
        branchName: "feature/runtime-salvage",
        commitSha: "abc125",
        filesChanged: ["src/salvaged.ts"],
        outOfScopeFiles: [],
        uncommittedFiles: [],
        remoteCheckReason: "Commit exists on remote",
      },
    });

    const dispatcherClient = {
      register: vi.fn(async () => ({})),
      fetchTask: vi.fn(async () => ({
        status: "task",
        task: {
          task_id: "task-3",
          repo: "repo",
          branch: "feature/runtime-salvage",
          default_branch: "main",
          scope: ["src/**"],
          acceptance: ["pnpm test"],
          constraints: [],
          prompt: "Recover artifacts after interruption",
        },
      })),
      startTask: vi.fn(async () => ({})),
      reportProgress: vi.fn(async () => ({})),
      submitResult: vi.fn(async () => ({})),
      heartbeat: vi.fn(async () => ({})),
    };
    const automationClient = {
      ready: vi.fn(async () => ({ ready: true })),
      prepareSession: vi.fn(async () => ({ data: { sessionId: "session-456" } })),
      getSession: vi.fn(async () => ({ data: { status: "interrupted", error: "Gateway restarted" } })),
      sendChat: vi.fn(async () => {
        throw new Error("request timeout: /v1/chat");
      }),
      releaseSession: vi.fn(async () => ({ data: { sessionId: "session-456", released: true } })),
    };
    const launchTrae = vi.fn(async () => ({ reusedExisting: false }));

    const { createTraeAutomationWorkerRuntime } = await import("../../src/runtime/worker.js");
    const runtime = createTraeAutomationWorkerRuntime({
      dispatcherClient: dispatcherClient as never,
      automationClient: automationClient as never,
      workerId: "trae-remote",
      repoDir: "/tmp/project",
      logger: { warn: vi.fn(), log: vi.fn() },
      launchTrae,
      sleep: vi.fn(async () => undefined),
      setIntervalImpl: vi.fn(() => ({}) as never),
      clearIntervalImpl: vi.fn(),
    });

    const result = await runtime.runOnce();

    expect(checkArtifactReviewabilityMock).toHaveBeenCalledWith(expect.objectContaining({
      task_id: "task-3",
      execution_dir: "/tmp/project",
    }));
    expect(dispatcherClient.submitResult).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "task-3",
      status: "review_ready",
      summary: expect.stringContaining("Recovered via artifact check"),
      risks: ["Error: Gateway restarted"],
      filesChanged: ["src/salvaged.ts"],
      github: {
        branchName: "feature/runtime-salvage",
        commitSha: "abc125",
        pushStatus: "verified",
        pushError: null,
        prNumber: null,
        prUrl: null,
      },
    }));
    expect(automationClient.releaseSession).toHaveBeenCalledWith("session-456");
    expect(result).toEqual({
      status: "review_ready",
      taskId: "task-3",
      responseText: expect.stringContaining("Recovered via artifact check"),
    });

    runtime.stop();
  });

  it("releases the session when task execution fails", async () => {
    const dispatcherClient = {
      register: vi.fn(async () => ({})),
      fetchTask: vi.fn(async () => ({
        status: "task",
        task: {
          task_id: "task-4",
          repo: "repo",
          branch: "feature/runtime-failure",
          default_branch: "main",
          scope: ["src/**"],
          acceptance: ["pnpm test"],
          constraints: [],
          prompt: "Fail and clean up the session",
        },
      })),
      startTask: vi.fn(async () => ({})),
      reportProgress: vi.fn(async () => ({})),
      submitResult: vi.fn(async () => ({})),
      heartbeat: vi.fn(async () => ({})),
    };
    const automationClient = {
      ready: vi.fn(async () => ({ ready: true })),
      prepareSession: vi.fn(async () => ({ data: { sessionId: "session-789" } })),
      getSession: vi.fn(async () => ({ data: { status: "failed", error: "Gateway restarted" } })),
      sendChat: vi.fn(async () => {
        throw new Error("request timeout: /v1/chat");
      }),
      releaseSession: vi.fn(async () => ({ data: { sessionId: "session-789", released: true } })),
    };
    const launchTrae = vi.fn(async () => ({ reusedExisting: false }));

    const { createTraeAutomationWorkerRuntime } = await import("../../src/runtime/worker.js");
    const runtime = createTraeAutomationWorkerRuntime({
      dispatcherClient: dispatcherClient as never,
      automationClient: automationClient as never,
      workerId: "trae-remote",
      repoDir: "/tmp/project",
      logger: { warn: vi.fn(), log: vi.fn() },
      launchTrae,
      sleep: vi.fn(async () => undefined),
      setIntervalImpl: vi.fn(() => ({}) as never),
      clearIntervalImpl: vi.fn(),
    });

    const result = await runtime.runOnce();

    expect(dispatcherClient.submitResult).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "task-4",
      status: "failed",
      summary: "Gateway restarted",
    }));
    expect(automationClient.releaseSession).toHaveBeenCalledWith("session-789");
    expect(result).toEqual({
      status: "failed",
      taskId: "task-4",
      error: "Gateway restarted",
    });

    runtime.stop();
  });

  it("rejects a parsed result with a mismatched task ID", async () => {
    const dispatcherClient = {
      register: vi.fn(async () => ({})),
      fetchTask: vi.fn(async () => ({
        status: "task",
        task: {
          task_id: "task-5",
          repo: "repo",
          branch: "feature/runtime-mismatch",
          default_branch: "main",
          scope: ["src/**"],
          acceptance: ["pnpm test"],
          constraints: [],
          prompt: "Verify task ID mismatch is rejected",
        },
      })),
      startTask: vi.fn(async () => ({})),
      reportProgress: vi.fn(async () => ({})),
      submitResult: vi.fn(async () => ({})),
      heartbeat: vi.fn(async () => ({})),
    };
    const automationClient = {
      ready: vi.fn(async () => ({ ready: true })),
      prepareSession: vi.fn(async () => ({ data: { sessionId: "session-mismatch" } })),
      sendChat: vi.fn(async () => ({
        response: {
          text: [
            "## 任务完成",
            "- 结果: 成功",
            "- 任务ID: task-3",
            "- 修改文件: src/old.ts",
            "- 测试结果: none",
            "- 风险: 无",
            "- GitHub 证据:",
            "  - branch: feature/old",
            "  - commit: abc999",
            "  - push: 成功",
            "  - push_error: 无",
            "  - PR: 无",
            "  - PR URL: 无",
            "- 备注: stale response",
          ].join("\n"),
        },
      })),
      releaseSession: vi.fn(async () => ({ data: { sessionId: "session-mismatch", released: true } })),
    };
    const launchTrae = vi.fn(async () => ({ reusedExisting: false }));

    const { createTraeAutomationWorkerRuntime } = await import("../../src/runtime/worker.js");
    const runtime = createTraeAutomationWorkerRuntime({
      dispatcherClient: dispatcherClient as never,
      automationClient: automationClient as never,
      workerId: "trae-remote",
      repoDir: "/tmp/project",
      logger: { warn: vi.fn(), log: vi.fn() },
      launchTrae,
      sleep: vi.fn(async () => undefined),
      setIntervalImpl: vi.fn(() => ({}) as never),
      clearIntervalImpl: vi.fn(),
    });

    const result = await runtime.runOnce();

    expect(dispatcherClient.submitResult).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "task-5",
      status: "failed",
      summary: expect.stringContaining('Task ID mismatch'),
    }));
    expect(automationClient.releaseSession).toHaveBeenCalledWith("session-mismatch");
    expect(result).toEqual({
      status: "failed",
      taskId: "task-5",
      error: expect.stringContaining('Task ID mismatch'),
    });

    runtime.stop();
  });

  it("accepts a dispatch task ID when the final report replaces the separator colon with a hyphen", async () => {
    const dispatcherClient = {
      register: vi.fn(async () => ({})),
      fetchTask: vi.fn(async () => ({
        status: "task",
        task: {
          task_id: "dispatch-103:continuation-remote-smoke-1",
          repo: "repo",
          branch: "feature/runtime-dispatch-id-normalization",
          default_branch: "main",
          scope: ["docs/**"],
          acceptance: ["git diff --check"],
          constraints: [],
          prompt: "Accept the canonical dispatch task ID even if the model normalizes the separator",
        },
      })),
      startTask: vi.fn(async () => ({})),
      reportProgress: vi.fn(async () => ({})),
      submitResult: vi.fn(async () => ({})),
      heartbeat: vi.fn(async () => ({})),
    };
    const automationClient = {
      ready: vi.fn(async () => ({ ready: true })),
      prepareSession: vi.fn(async () => ({ data: { sessionId: "session-dispatch-normalization" } })),
      sendChat: vi.fn(async () => ({
        response: {
          text: [
            "## 任务完成",
            "- 结果: 成功",
            "- 任务ID: dispatch-103-continuation-remote-smoke-1",
            "- 修改文件: docs/smoke/continuation-remote-smoke.md",
            "- 测试结果: git diff --check",
            "- 风险: 无",
            "- GitHub 证据:",
            "  - branch: ai/trae/continuation-remote-smoke-20260401",
            "  - commit: abc123",
            "  - push: 成功",
            "  - push_error: 无",
            "  - PR: 无",
            "  - PR URL: 无",
            "- 备注: normalized dispatch task id",
          ].join("\n"),
        },
      })),
      releaseSession: vi.fn(async () => ({
        data: {
          sessionId: "session-dispatch-normalization",
          released: true,
        },
      })),
    };
    const launchTrae = vi.fn(async () => ({ reusedExisting: false }));

    const { createTraeAutomationWorkerRuntime } = await import("../../src/runtime/worker.js");
    const runtime = createTraeAutomationWorkerRuntime({
      dispatcherClient: dispatcherClient as never,
      automationClient: automationClient as never,
      workerId: "trae-remote",
      repoDir: "/tmp/project",
      logger: { warn: vi.fn(), log: vi.fn() },
      launchTrae,
      sleep: vi.fn(async () => undefined),
      setIntervalImpl: vi.fn(() => ({}) as never),
      clearIntervalImpl: vi.fn(),
    });

    const result = await runtime.runOnce();

    expect(dispatcherClient.submitResult).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "dispatch-103:continuation-remote-smoke-1",
      status: "review_ready",
      summary: "normalized dispatch task id",
    }));
    expect(result).toEqual({
      status: "review_ready",
      taskId: "dispatch-103:continuation-remote-smoke-1",
      responseText: expect.stringContaining("dispatch-103-continuation-remote-smoke-1"),
    });

    runtime.stop();
  });

  it("defaults to new_chat when continuationMode is not set", async () => {
    const dispatcherClient = {
      register: vi.fn(async () => ({})),
      fetchTask: vi.fn(async () => ({
        status: "task",
        task: {
          task_id: "task-6",
          repo: "repo",
          branch: "feature/fresh-task",
          default_branch: "main",
          scope: ["src/**"],
          acceptance: ["pnpm test"],
          constraints: [],
          prompt: "Fresh task without continuationMode",
        },
      })),
      startTask: vi.fn(async () => ({})),
      reportProgress: vi.fn(async () => ({})),
      submitResult: vi.fn(async () => ({})),
      heartbeat: vi.fn(async () => ({})),
    };
    const automationClient = {
      ready: vi.fn(async () => ({ ready: true })),
      prepareSession: vi.fn(async () => ({ data: { sessionId: "session-fresh" } })),
      sendChat: vi.fn(async () => ({
        response: {
          text: [
            "## 任务完成",
            "- 结果: 成功",
            "- 任务ID: task-6",
            "- 修改文件: src/new.ts",
            "- 测试结果: pnpm test",
            "- 风险: 无",
            "- GitHub 证据:",
            "  - branch: feature/fresh-task",
            "  - commit: abc126",
            "  - push: 成功",
            "  - push_error: 无",
            "  - PR: 无",
            "  - PR URL: 无",
            "- 备注: fresh task",
          ].join("\n"),
        },
      })),
      releaseSession: vi.fn(async () => ({})),
    };
    const launchTrae = vi.fn(async () => ({ reusedExisting: false }));

    const { createTraeAutomationWorkerRuntime } = await import("../../src/runtime/worker.js");
    const runtime = createTraeAutomationWorkerRuntime({
      dispatcherClient: dispatcherClient as never,
      automationClient: automationClient as never,
      workerId: "trae-remote",
      repoDir: "/tmp/project",
      logger: { warn: vi.fn(), log: vi.fn() },
      launchTrae,
      sleep: vi.fn(async () => undefined),
      setIntervalImpl: vi.fn(() => ({}) as never),
      clearIntervalImpl: vi.fn(),
    });

    await runtime.runOnce();

    expect(automationClient.prepareSession).toHaveBeenCalledWith({
      discovery: expect.objectContaining({
        titleContains: expect.arrayContaining(["task-6"]),
      }),
      chatMode: "new_chat",
    });
    expect(automationClient.sendChat).toHaveBeenCalledWith(expect.objectContaining({
      chatMode: "new_chat",
    }));

    runtime.stop();
  });

  it("uses continue mode when continuationMode=continue", async () => {
    const dispatcherClient = {
      register: vi.fn(async () => ({})),
      fetchTask: vi.fn(async () => ({
        status: "task",
        task: {
          task_id: "task-7",
          repo: "repo",
          branch: "feature/continue-task",
          default_branch: "main",
          scope: ["src/**"],
          acceptance: ["pnpm test"],
          constraints: [],
          prompt: "Continue existing session",
          continuationMode: "continue",
        },
      })),
      startTask: vi.fn(async () => ({})),
      reportProgress: vi.fn(async () => ({})),
      submitResult: vi.fn(async () => ({})),
      heartbeat: vi.fn(async () => ({})),
    };
    const automationClient = {
      ready: vi.fn(async () => ({ ready: true })),
      prepareSession: vi.fn(async () => ({ data: { sessionId: "session-continue" } })),
      sendChat: vi.fn(async () => ({
        response: {
          text: [
            "## 任务完成",
            "- 结果: 成功",
            "- 任务ID: task-7",
            "- 修改文件: src/continued.ts",
            "- 测试结果: pnpm test",
            "- 风险: 无",
            "- GitHub 证据:",
            "  - branch: feature/continue-task",
            "  - commit: abc127",
            "  - push: 成功",
            "  - push_error: 无",
            "  - PR: 无",
            "  - PR URL: 无",
            "- 备注: continued session",
          ].join("\n"),
        },
      })),
      releaseSession: vi.fn(async () => ({})),
    };
    const launchTrae = vi.fn(async () => ({ reusedExisting: false }));

    const { createTraeAutomationWorkerRuntime } = await import("../../src/runtime/worker.js");
    const runtime = createTraeAutomationWorkerRuntime({
      dispatcherClient: dispatcherClient as never,
      automationClient: automationClient as never,
      workerId: "trae-remote",
      repoDir: "/tmp/project",
      logger: { warn: vi.fn(), log: vi.fn() },
      launchTrae,
      sleep: vi.fn(async () => undefined),
      setIntervalImpl: vi.fn(() => ({}) as never),
      clearIntervalImpl: vi.fn(),
    });

    await runtime.runOnce();

    expect(automationClient.prepareSession).toHaveBeenCalledWith({
      discovery: expect.objectContaining({
        titleContains: expect.arrayContaining(["task-7"]),
      }),
      chatMode: "continue",
    });
    expect(automationClient.sendChat).toHaveBeenCalledWith(expect.objectContaining({
      chatMode: "continue",
    }));

    runtime.stop();
  });

  it("does not propagate continuationMode=rework as chatMode", async () => {
    const dispatcherClient = {
      register: vi.fn(async () => ({})),
      fetchTask: vi.fn(async () => ({
        status: "task",
        task: {
          task_id: "task-8",
          repo: "repo",
          branch: "feature/rework-task",
          default_branch: "main",
          scope: ["src/**"],
          acceptance: ["pnpm test"],
          constraints: [],
          prompt: "Rework existing code",
          continuationMode: "rework",
        },
      })),
      startTask: vi.fn(async () => ({})),
      reportProgress: vi.fn(async () => ({})),
      submitResult: vi.fn(async () => ({})),
      heartbeat: vi.fn(async () => ({})),
    };
    const automationClient = {
      ready: vi.fn(async () => ({ ready: true })),
      prepareSession: vi.fn(async () => ({ data: { sessionId: "session-rework" } })),
      sendChat: vi.fn(async () => ({
        response: {
          text: [
            "## 任务完成",
            "- 结果: 成功",
            "- 任务ID: task-8",
            "- 修改文件: src/reworked.ts",
            "- 测试结果: pnpm test",
            "- 风险: 无",
            "- GitHub 证据:",
            "  - branch: feature/rework-task",
            "  - commit: abc128",
            "  - push: 成功",
            "  - push_error: 无",
            "  - PR: 无",
            "  - PR URL: 无",
            "- 备注: rework task",
          ].join("\n"),
        },
      })),
      releaseSession: vi.fn(async () => ({})),
    };
    const launchTrae = vi.fn(async () => ({ reusedExisting: false }));

    const { createTraeAutomationWorkerRuntime } = await import("../../src/runtime/worker.js");
    const runtime = createTraeAutomationWorkerRuntime({
      dispatcherClient: dispatcherClient as never,
      automationClient: automationClient as never,
      workerId: "trae-remote",
      repoDir: "/tmp/project",
      logger: { warn: vi.fn(), log: vi.fn() },
      launchTrae,
      sleep: vi.fn(async () => undefined),
      setIntervalImpl: vi.fn(() => ({}) as never),
      clearIntervalImpl: vi.fn(),
    });

    await runtime.runOnce();

    expect(automationClient.prepareSession).toHaveBeenCalledWith({
      discovery: expect.objectContaining({
        titleContains: expect.arrayContaining(["task-8"]),
      }),
      chatMode: "new_chat",
    });
    expect(automationClient.sendChat).toHaveBeenCalledWith(expect.objectContaining({
      chatMode: "new_chat",
    }));

    runtime.stop();
  });

  it("supports chat_mode=continue for backward compatibility", async () => {
    const dispatcherClient = {
      register: vi.fn(async () => ({})),
      fetchTask: vi.fn(async () => ({
        status: "task",
        task: {
          task_id: "task-9",
          repo: "repo",
          branch: "feature/chat-continue",
          default_branch: "main",
          scope: ["src/**"],
          acceptance: ["pnpm test"],
          constraints: [],
          prompt: "Continue using chat_mode",
          chat_mode: "continue",
        },
      })),
      startTask: vi.fn(async () => ({})),
      reportProgress: vi.fn(async () => ({})),
      submitResult: vi.fn(async () => ({})),
      heartbeat: vi.fn(async () => ({})),
    };
    const automationClient = {
      ready: vi.fn(async () => ({ ready: true })),
      prepareSession: vi.fn(async () => ({ data: { sessionId: "session-chat-continue" } })),
      sendChat: vi.fn(async () => ({
        response: {
          text: [
            "## 任务完成",
            "- 结果: 成功",
            "- 任务ID: task-9",
            "- 修改文件: src/chat-continue.ts",
            "- 测试结果: pnpm test",
            "- 风险: 无",
            "- GitHub 证据:",
            "  - branch: feature/chat-continue",
            "  - commit: abc129",
            "  - push: 成功",
            "  - push_error: 无",
            "  - PR: 无",
            "  - PR URL: 无",
            "- 备注: chat_mode continue",
          ].join("\n"),
        },
      })),
      releaseSession: vi.fn(async () => ({})),
    };
    const launchTrae = vi.fn(async () => ({ reusedExisting: false }));

    const { createTraeAutomationWorkerRuntime } = await import("../../src/runtime/worker.js");
    const runtime = createTraeAutomationWorkerRuntime({
      dispatcherClient: dispatcherClient as never,
      automationClient: automationClient as never,
      workerId: "trae-remote",
      repoDir: "/tmp/project",
      logger: { warn: vi.fn(), log: vi.fn() },
      launchTrae,
      sleep: vi.fn(async () => undefined),
      setIntervalImpl: vi.fn(() => ({}) as never),
      clearIntervalImpl: vi.fn(),
    });

    await runtime.runOnce();

    expect(automationClient.prepareSession).toHaveBeenCalledWith({
      discovery: expect.objectContaining({
        titleContains: expect.arrayContaining(["task-9"]),
      }),
      chatMode: "continue",
    });
    expect(automationClient.sendChat).toHaveBeenCalledWith(expect.objectContaining({
      chatMode: "continue",
    }));

    runtime.stop();
  });

  it("accepts a dispatch task id report that only keeps the dispatch prefix", async () => {
    const dispatcherClient = {
      register: vi.fn(async () => ({})),
      fetchTask: vi.fn(async () => ({
        status: "task",
        task: {
          task_id: "dispatch-118:fix-review-memory-tests-sqlite-assumption-remote",
          repo: "repo",
          branch: "feature/review-memory-fix",
          default_branch: "main",
          scope: ["apps/dispatcher/tests/modules/server/review-memory.test.ts"],
          acceptance: ["pnpm --filter @forgeflow/dispatcher test tests/modules/server/review-memory.test.ts"],
          constraints: [],
          prompt: "Fix review-memory tests for SQLite default runtime state",
        },
      })),
      startTask: vi.fn(async () => ({})),
      reportProgress: vi.fn(async () => ({})),
      submitResult: vi.fn(async () => ({})),
      heartbeat: vi.fn(async () => ({})),
    };
    const automationClient = {
      ready: vi.fn(async () => ({ ready: true })),
      prepareSession: vi.fn(async () => ({ data: { sessionId: "session-dispatch-prefix" } })),
      sendChat: vi.fn(async () => ({
        response: {
          text: [
            "## 任务完成",
            "- 结果: 成功",
            "- 任务ID: dispatch-118",
            "- 修改文件: apps/dispatcher/tests/modules/server/review-memory.test.ts",
            "- 测试结果: pnpm --filter @forgeflow/dispatcher test tests/modules/server/review-memory.test.ts",
            "- 风险: 无",
            "- GitHub 证据:",
            "  - branch: ai/trae/fix-review-memory-tests-sqlite-assumption-remote",
            "  - commit: d98874ef38c2622a0073e2fc6923557e0e42690a",
            "  - push: 成功",
            "  - push_error: 无",
            "  - PR: 无",
            "  - PR URL: 无",
            "- 备注: dispatch prefix only",
          ].join("\n"),
        },
      })),
      releaseSession: vi.fn(async () => ({
        data: {
          sessionId: "session-dispatch-prefix",
          released: true,
        },
      })),
    };
    const launchTrae = vi.fn(async () => ({ reusedExisting: false }));

    const { createTraeAutomationWorkerRuntime } = await import("../../src/runtime/worker.js");
    const runtime = createTraeAutomationWorkerRuntime({
      dispatcherClient: dispatcherClient as never,
      automationClient: automationClient as never,
      workerId: "trae-remote",
      repoDir: "/tmp/project",
      logger: { warn: vi.fn(), log: vi.fn() },
      launchTrae,
      sleep: vi.fn(async () => undefined),
      setIntervalImpl: vi.fn(() => ({}) as never),
      clearIntervalImpl: vi.fn(),
    });

    const result = await runtime.runOnce();

    expect(dispatcherClient.submitResult).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "dispatch-118:fix-review-memory-tests-sqlite-assumption-remote",
      status: "review_ready",
      summary: "dispatch prefix only",
    }));
    expect(result).toEqual({
      status: "review_ready",
      taskId: "dispatch-118:fix-review-memory-tests-sqlite-assumption-remote",
      responseText: expect.stringContaining("- 任务ID: dispatch-118"),
    });

    runtime.stop();
  });

  it("fails when final report contains a real stale task ID from a previous task", async () => {
    const dispatcherClient = {
      register: vi.fn(async () => ({})),
      fetchTask: vi.fn(async () => ({
        status: "task",
        task: {
          task_id: "dispatch-121:stale-test",
          repo: "repo",
          branch: "feature/stale-test",
          default_branch: "main",
          scope: ["src/**"],
          acceptance: ["pnpm test"],
          constraints: [],
          prompt: "Test stale task ID rejection",
        },
      })),
      startTask: vi.fn(async () => ({})),
      reportProgress: vi.fn(async () => ({})),
      submitResult: vi.fn(async () => ({})),
      heartbeat: vi.fn(async () => ({})),
    };
    const automationClient = {
      ready: vi.fn(async () => ({ ready: true })),
      prepareSession: vi.fn(async () => ({ data: { sessionId: "session-stale" } })),
      sendChat: vi.fn(async () => ({
        response: {
          text: [
            "## 任务完成",
            "- 结果: 成功",
            "- 任务ID: dispatch-099:old-task",
            "- 修改文件: src/old.ts",
            "- 测试结果: none",
            "- 风险: 无",
            "- GitHub 证据:",
            "  - branch: feature/old",
            "  - commit: abc999",
            "  - push: 成功",
            "  - push_error: 无",
            "- 备注: stale response from previous task",
          ].join("\n"),
        },
      })),
      releaseSession: vi.fn(async () => ({ data: { sessionId: "session-stale", released: true } })),
    };
    const launchTrae = vi.fn(async () => ({ reusedExisting: false }));

    const { createTraeAutomationWorkerRuntime } = await import("../../src/runtime/worker.js");
    const runtime = createTraeAutomationWorkerRuntime({
      dispatcherClient: dispatcherClient as never,
      automationClient: automationClient as never,
      workerId: "trae-remote",
      repoDir: "/tmp/project",
      logger: { warn: vi.fn(), log: vi.fn() },
      launchTrae,
      sleep: vi.fn(async () => undefined),
      setIntervalImpl: vi.fn(() => ({}) as never),
      clearIntervalImpl: vi.fn(),
    });

    const result = await runtime.runOnce();

    expect(dispatcherClient.submitResult).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "dispatch-121:stale-test",
      status: "failed",
      summary: expect.stringContaining("Task ID mismatch"),
    }));
    expect(result).toEqual({
      status: "failed",
      taskId: "dispatch-121:stale-test",
      error: expect.stringContaining("Task ID mismatch"),
    });

    runtime.stop();
  });

  it("recovers from a stale dispatcher task response by re-reading the current session once", async () => {
    const dispatcherClient = {
      register: vi.fn(async () => ({})),
      fetchTask: vi.fn(async () => ({
        status: "task",
        task: {
          task_id: "dispatch-150:redrive-19b26510",
          repo: "repo",
          branch: "feature/task-id-recovery",
          default_branch: "main",
          scope: ["src/**"],
          acceptance: ["pnpm test"],
          constraints: [],
          prompt: "Recover from stale dispatcher response",
        },
      })),
      startTask: vi.fn(async () => ({})),
      reportProgress: vi.fn(async () => ({})),
      submitResult: vi.fn(async () => ({})),
      heartbeat: vi.fn(async () => ({})),
    };
    const automationClient = {
      ready: vi.fn(async () => ({ ready: true })),
      prepareSession: vi.fn(async () => ({ data: { sessionId: "session-task-id-recovery" } })),
      getSession: vi.fn(async () => ({
        data: {
          status: "completed",
          responseText: [
            "## 任务完成",
            "- 结果: 成功",
            "- 任务ID: dispatch-150:redrive-19b26510",
            "- 修改文件: apps/dispatcher/src/modules/server/dispatcher-server.ts",
            "- 测试结果: pnpm test",
            "- 风险: 无",
            "- GitHub 证据:",
            "  - branch: ai/trae/harden-dispatcher-auth-defaults-20260404-redrive-fullscope-19b26510",
            "  - commit: abc150",
            "  - push: 成功",
            "  - push_error: 无",
            "  - PR: 无",
            "  - PR URL: 无",
            "- 备注: recovered from current session",
          ].join("\n"),
        },
      })),
      sendChat: vi.fn(async () => ({
        response: {
          text: [
            "## 任务完成",
            "- 结果: 成功",
            "- 任务ID: dispatch-149:redrive-6959e7c2",
            "- 修改文件: docs/onboarding.md",
            "- 测试结果: none",
            "- 风险: 无",
            "- GitHub 证据:",
            "  - branch: ai/trae/harden-dispatcher-auth-defaults-20260404-redrive-remote-6959e7c2",
            "  - commit: abc149",
            "  - push: 成功",
            "  - push_error: 无",
            "  - PR: 无",
            "  - PR URL: 无",
            "- 备注: stale response from previous task",
          ].join("\n"),
        },
      })),
      releaseSession: vi.fn(async () => ({ data: { sessionId: "session-task-id-recovery", released: true } })),
    };
    const launchTrae = vi.fn(async () => ({ reusedExisting: false }));

    const { createTraeAutomationWorkerRuntime } = await import("../../src/runtime/worker.js");
    const runtime = createTraeAutomationWorkerRuntime({
      dispatcherClient: dispatcherClient as never,
      automationClient: automationClient as never,
      workerId: "trae-remote",
      repoDir: "/tmp/project",
      logger: { warn: vi.fn(), log: vi.fn() },
      launchTrae,
      sleep: vi.fn(async () => undefined),
      setIntervalImpl: vi.fn(() => ({}) as never),
      clearIntervalImpl: vi.fn(),
    });

    const result = await runtime.runOnce();

    expect(automationClient.sendChat).toHaveBeenCalledTimes(1);
    expect(automationClient.getSession).toHaveBeenCalledWith("session-task-id-recovery");
    expect(dispatcherClient.submitResult).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "dispatch-150:redrive-19b26510",
      status: "review_ready",
      summary: "recovered from current session",
    }));
    expect(result).toEqual({
      status: "review_ready",
      taskId: "dispatch-150:redrive-19b26510",
      responseText: expect.stringContaining("recovered from current session"),
    });

    runtime.stop();
  });

  it("recovers from template echo via read-only session instead of resending prompt", async () => {
    const dispatcherClient = {
      register: vi.fn(async () => ({})),
      fetchTask: vi.fn(async () => ({
        status: "task",
        task: {
          task_id: "dispatch-200:placeholder-recovery",
          repo: "repo",
          branch: "feature/placeholder-recovery",
          default_branch: "main",
          scope: ["src/**"],
          acceptance: ["pnpm test"],
          constraints: [],
          prompt: "Test placeholder recovery",
        },
      })),
      startTask: vi.fn(async () => ({})),
      reportProgress: vi.fn(async () => ({})),
      submitResult: vi.fn(async () => ({})),
      heartbeat: vi.fn(async () => ({})),
    };
    const automationClient = {
      ready: vi.fn(async () => ({ ready: true })),
      prepareSession: vi.fn(async () => ({ data: { sessionId: "session-placeholder-recovery" } })),
      getSession: vi.fn(async () => ({
        data: {
          status: "completed",
          responseText: [
            "## 任务完成",
            "- 结果: 成功",
            "- 任务ID: dispatch-200:placeholder-recovery",
            "- 修改文件: src/real.ts",
            "- 测试结果: pnpm test",
            "- 风险: 无",
            "- GitHub 证据:",
            "  - branch: feature/placeholder-recovery",
            "  - commit: abc200",
            "  - push: 成功",
            "  - push_error: 无",
            "- 备注: real response after placeholder",
          ].join("\n"),
        },
      })),
      sendChat: vi.fn(async () => ({
        response: {
          text: [
            "## 任务完成",
            "- 结果: 成功",
            "- 任务ID: <task_id>",
            "- 修改文件: src/placeholder.ts",
            "- 测试结果: none",
            "- 风险: 无",
            "- GitHub 证据:",
            "  - branch: feature/placeholder",
            "  - commit: abc999",
            "  - push: 成功",
            "  - push_error: 无",
            "- 备注: placeholder response",
          ].join("\n"),
        },
      })),
      releaseSession: vi.fn(async () => ({ data: { sessionId: "session-placeholder-recovery", released: true } })),
    };
    const launchTrae = vi.fn(async () => ({ reusedExisting: false }));

    const { createTraeAutomationWorkerRuntime } = await import("../../src/runtime/worker.js");
    const runtime = createTraeAutomationWorkerRuntime({
      dispatcherClient: dispatcherClient as never,
      automationClient: automationClient as never,
      workerId: "trae-remote",
      repoDir: "/tmp/project",
      logger: { warn: vi.fn(), log: vi.fn() },
      launchTrae,
      sleep: vi.fn(async () => undefined),
      setIntervalImpl: vi.fn(() => ({}) as never),
      clearIntervalImpl: vi.fn(),
    });

    const result = await runtime.runOnce();

    expect(automationClient.sendChat).toHaveBeenCalledTimes(1);
    expect(automationClient.getSession).toHaveBeenCalledWith("session-placeholder-recovery");
    expect(dispatcherClient.reportProgress).toHaveBeenCalledWith(
      "dispatch-200:placeholder-recovery",
      "Session completed, extracting stored response",
      "trae-remote"
    );
    expect(dispatcherClient.submitResult).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "dispatch-200:placeholder-recovery",
      status: "review_ready",
      summary: "real response after placeholder",
    }));
    expect(result).toEqual({
      status: "review_ready",
      taskId: "dispatch-200:placeholder-recovery",
      responseText: expect.stringContaining("real response after placeholder"),
    });

    runtime.stop();
  });

  it("uses read-only session response on timeout recovery instead of resending prompt", async () => {
    const dispatcherClient = {
      register: vi.fn(async () => ({})),
      fetchTask: vi.fn(async () => ({
        status: "task",
        task: {
          task_id: "dispatch-201:readonly-recovery",
          repo: "repo",
          branch: "feature/readonly-recovery",
          default_branch: "main",
          scope: ["src/**"],
          acceptance: ["pnpm test"],
          constraints: [],
          prompt: "Test readonly recovery",
        },
      })),
      startTask: vi.fn(async () => ({})),
      reportProgress: vi.fn(async () => ({})),
      submitResult: vi.fn(async () => ({})),
      heartbeat: vi.fn(async () => ({})),
    };
    let chatCallCount = 0;
    const automationClient = {
      ready: vi.fn(async () => ({ ready: true })),
      prepareSession: vi.fn(async () => ({ data: { sessionId: "session-readonly" } })),
      getSession: vi.fn(async () => ({
        data: {
          status: "completed",
          responseText: [
            "## 任务完成",
            "- 结果: 成功",
            "- 任务ID: dispatch-201:readonly-recovery",
            "- 修改文件: src/readonly.ts",
            "- 测试结果: pnpm test",
            "- 风险: 无",
            "- GitHub 证据:",
            "  - branch: feature/readonly-recovery",
            "  - commit: abc201",
            "  - push: 成功",
            "  - push_error: 无",
            "- 备注: readonly recovery",
          ].join("\n"),
        },
      })),
      sendChat: vi.fn(async () => {
        chatCallCount += 1;
        throw new Error("request timeout: /v1/chat");
      }),
      releaseSession: vi.fn(async () => ({ data: { sessionId: "session-readonly", released: true } })),
    };
    const launchTrae = vi.fn(async () => ({ reusedExisting: false }));

    const { createTraeAutomationWorkerRuntime } = await import("../../src/runtime/worker.js");
    const runtime = createTraeAutomationWorkerRuntime({
      dispatcherClient: dispatcherClient as never,
      automationClient: automationClient as never,
      workerId: "trae-remote",
      repoDir: "/tmp/project",
      logger: { warn: vi.fn(), log: vi.fn() },
      launchTrae,
      sleep: vi.fn(async () => undefined),
      setIntervalImpl: vi.fn(() => ({}) as never),
      clearIntervalImpl: vi.fn(),
    });

    const result = await runtime.runOnce();

    expect(automationClient.sendChat).toHaveBeenCalledTimes(1);
    expect(automationClient.getSession).toHaveBeenCalledWith("session-readonly");
    expect(dispatcherClient.reportProgress).toHaveBeenCalledWith(
      "dispatch-201:readonly-recovery",
      "Session completed, extracting stored response",
      "trae-remote"
    );
    expect(dispatcherClient.submitResult).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "dispatch-201:readonly-recovery",
      status: "review_ready",
      summary: "readonly recovery",
    }));
    expect(result).toEqual({
      status: "review_ready",
      taskId: "dispatch-201:readonly-recovery",
      responseText: expect.stringContaining("readonly recovery"),
    });

    runtime.stop();
  });

  it("fails when session completed but responseText is missing", async () => {
    const dispatcherClient = {
      register: vi.fn(async () => ({})),
      fetchTask: vi.fn(async () => ({
        status: "task",
        task: {
          task_id: "dispatch-202:missing-response",
          repo: "repo",
          branch: "feature/missing-response",
          default_branch: "main",
          scope: ["src/**"],
          acceptance: ["pnpm test"],
          constraints: [],
          prompt: "Test missing response",
        },
      })),
      startTask: vi.fn(async () => ({})),
      reportProgress: vi.fn(async () => ({})),
      submitResult: vi.fn(async () => ({})),
      heartbeat: vi.fn(async () => ({})),
    };
    const automationClient = {
      ready: vi.fn(async () => ({ ready: true })),
      prepareSession: vi.fn(async () => ({ data: { sessionId: "session-missing" } })),
      getSession: vi.fn(async () => ({
        data: {
          status: "completed",
          responseText: null,
        },
      })),
      sendChat: vi.fn(async () => {
        throw new Error("request timeout: /v1/chat");
      }),
      releaseSession: vi.fn(async () => ({ data: { sessionId: "session-missing", released: true } })),
    };
    const launchTrae = vi.fn(async () => ({ reusedExisting: false }));

    const { createTraeAutomationWorkerRuntime } = await import("../../src/runtime/worker.js");
    const runtime = createTraeAutomationWorkerRuntime({
      dispatcherClient: dispatcherClient as never,
      automationClient: automationClient as never,
      workerId: "trae-remote",
      repoDir: "/tmp/project",
      logger: { warn: vi.fn(), log: vi.fn() },
      launchTrae,
      sleep: vi.fn(async () => undefined),
      setIntervalImpl: vi.fn(() => ({}) as never),
      clearIntervalImpl: vi.fn(),
    });

    const result = await runtime.runOnce();

    expect(dispatcherClient.submitResult).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "dispatch-202:missing-response",
      status: "failed",
      summary: expect.stringContaining("no response text available"),
    }));
    expect(result).toEqual({
      status: "failed",
      taskId: "dispatch-202:missing-response",
      error: expect.stringContaining("no response text available"),
    });

    runtime.stop();
  });

  it("recovers from gateway-emitted 'Timed out waiting for Trae to finish responding' message", async () => {
    const dispatcherClient = {
      register: vi.fn(async () => ({})),
      fetchTask: vi.fn(async () => ({
        status: "task",
        task: {
          task_id: "dispatch-165:gateway-timeout-recovery",
          repo: "repo",
          branch: "feature/gateway-timeout-recovery",
          default_branch: "main",
          scope: ["src/**"],
          acceptance: ["pnpm test"],
          constraints: [],
          prompt: "Recover from gateway timeout message",
          chat_mode: "new_chat",
        },
      })),
      startTask: vi.fn(async () => ({})),
      reportProgress: vi.fn(async () => ({})),
      submitResult: vi.fn(async () => ({})),
      heartbeat: vi.fn(async () => ({})),
    };
    const automationClient = {
      ready: vi.fn(async () => ({ ready: true })),
      prepareSession: vi.fn(async () => ({ data: { sessionId: "session-gateway-timeout" } })),
      getSession: vi.fn(async () => ({
        data: {
          status: "completed",
          responseText: [
            "## 任务完成",
            "- 结果: 成功",
            "- 任务ID: dispatch-165:gateway-timeout-recovery",
            "- 修改文件: src/gateway-recovered.ts",
            "- 测试结果: gateway recovery",
            "- 风险: 无",
            "- GitHub 证据:",
            "  - branch: feature/gateway-timeout-recovery",
            "  - commit: abc165",
            "  - push: 成功",
            "  - push_error: 无",
            "  - PR: 无",
            "  - PR URL: 无",
            "- 备注: recovered from gateway timeout",
          ].join("\n"),
        },
      })),
      sendChat: vi.fn(async () => {
        throw new Error("Timed out waiting for Trae to finish responding");
      }),
      releaseSession: vi.fn(async () => ({ data: { sessionId: "session-gateway-timeout", released: true } })),
    };
    const launchTrae = vi.fn(async () => ({ reusedExisting: false }));

    const { createTraeAutomationWorkerRuntime } = await import("../../src/runtime/worker.js");
    const runtime = createTraeAutomationWorkerRuntime({
      dispatcherClient: dispatcherClient as never,
      automationClient: automationClient as never,
      workerId: "trae-remote",
      repoDir: "/tmp/project",
      logger: { warn: vi.fn(), log: vi.fn() },
      launchTrae,
      sleep: vi.fn(async () => undefined),
      setIntervalImpl: vi.fn(() => ({}) as never),
      clearIntervalImpl: vi.fn(),
    });

    const result = await runtime.runOnce();

    expect(automationClient.getSession).toHaveBeenCalledWith("session-gateway-timeout");
    expect(dispatcherClient.reportProgress).toHaveBeenCalledWith(
      "dispatch-165:gateway-timeout-recovery",
      "Chat timeout, checking session status",
      "trae-remote"
    );
    expect(dispatcherClient.reportProgress).toHaveBeenCalledWith(
      "dispatch-165:gateway-timeout-recovery",
      "Session completed, extracting stored response",
      "trae-remote"
    );
    expect(automationClient.releaseSession).toHaveBeenCalledWith("session-gateway-timeout");
    expect(result).toEqual({
      status: "review_ready",
      taskId: "dispatch-165:gateway-timeout-recovery",
      responseText: expect.stringContaining("## 任务完成"),
    });

    runtime.stop();
  });

  it("fails when session completed but response is still a template placeholder", async () => {
    const dispatcherClient = {
      register: vi.fn(async () => ({})),
      fetchTask: vi.fn(async () => ({
        status: "task",
        task: {
          task_id: "dispatch-203:completed-placeholder",
          repo: "repo",
          branch: "feature/completed-placeholder",
          default_branch: "main",
          scope: ["src/**"],
          acceptance: ["pnpm test"],
          constraints: [],
          prompt: "Test completed placeholder",
        },
      })),
      startTask: vi.fn(async () => ({})),
      reportProgress: vi.fn(async () => ({})),
      submitResult: vi.fn(async () => ({})),
      heartbeat: vi.fn(async () => ({})),
    };
    const automationClient = {
      ready: vi.fn(async () => ({ ready: true })),
      prepareSession: vi.fn(async () => ({ data: { sessionId: "session-completed-placeholder" } })),
      getSession: vi.fn(async () => ({
        data: {
          status: "completed",
          responseText: [
            "## 任务完成",
            "- 结果: 成功",
            "- 任务ID: <task_id>",
            "- 修改文件: src/placeholder.ts",
            "- 测试结果: none",
            "- 风险: 无",
            "- GitHub 证据:",
            "  - branch: feature/placeholder",
            "  - commit: abc999",
            "  - push: 成功",
            "  - push_error: 无",
            "- 备注: still placeholder",
          ].join("\n"),
        },
      })),
      sendChat: vi.fn(async () => {
        throw new Error("request timeout: /v1/chat");
      }),
      releaseSession: vi.fn(async () => ({ data: { sessionId: "session-completed-placeholder", released: true } })),
    };
    const launchTrae = vi.fn(async () => ({ reusedExisting: false }));

    const { createTraeAutomationWorkerRuntime } = await import("../../src/runtime/worker.js");
    const runtime = createTraeAutomationWorkerRuntime({
      dispatcherClient: dispatcherClient as never,
      automationClient: automationClient as never,
      workerId: "trae-remote",
      repoDir: "/tmp/project",
      logger: { warn: vi.fn(), log: vi.fn() },
      launchTrae,
      sleep: vi.fn(async () => undefined),
      setIntervalImpl: vi.fn(() => ({}) as never),
      clearIntervalImpl: vi.fn(),
    });

    const result = await runtime.runOnce();

    expect(dispatcherClient.submitResult).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "dispatch-203:completed-placeholder",
      status: "failed",
      summary: expect.stringContaining("template placeholder"),
    }));
    expect(result).toEqual({
      status: "failed",
      taskId: "dispatch-203:completed-placeholder",
      error: expect.stringContaining("template placeholder"),
    });

    runtime.stop();
  });

  it("accepts explicit environment_only success and preserves environment evidence", async () => {
    const dispatcherClient = {
      register: vi.fn(async () => ({})),
      fetchTask: vi.fn(async () => ({
        status: "task",
        task: {
          task_id: "dispatch-300:environment-only",
          repo: "repo",
          branch: "feature/environment-only",
          default_branch: "main",
          scope: ["packages/**"],
          acceptance: ["pnpm --filter @tingrudeng/trae-beta-runtime typecheck"],
          constraints: [],
          prompt: "Diagnose whether the typecheck issue is environment-only",
          chat_mode: "new_chat",
        },
      })),
      startTask: vi.fn(async () => ({})),
      reportProgress: vi.fn(async () => ({})),
      submitResult: vi.fn(async () => ({})),
      heartbeat: vi.fn(async () => ({})),
    };
    const automationClient = {
      ready: vi.fn(async () => ({ ready: true })),
      prepareSession: vi.fn(async () => ({ data: { sessionId: "session-environment-only" } })),
      sendChat: vi.fn(async () => ({
        response: {
          text: [
            "## 任务完成",
            "- 结果: 成功",
            "- 任务ID: dispatch-300:environment-only",
            "- 结论类型: environment_only",
            "- 修改文件: 无",
            "- 测试结果: pnpm --filter @tingrudeng/trae-beta-runtime typecheck",
            "- 风险: 无",
            "- 环境证据: pnpm install fixed the missing workspace dependency",
            "same checkout now resolves @forgeflow/result-contracts",
            "- GitHub 证据:",
            "  - branch: 无",
            "  - commit: 无",
            "  - push: 无",
            "  - push_error: 无",
            "  - PR: 无",
            "  - PR URL: 无",
            "- 备注: no repo code change",
          ].join("\n"),
        },
      })),
      releaseSession: vi.fn(async () => ({ data: { sessionId: "session-environment-only", released: true } })),
    };

    const { createTraeAutomationWorkerRuntime } = await import("../../src/runtime/worker.js");
    const runtime = createTraeAutomationWorkerRuntime({
      dispatcherClient: dispatcherClient as never,
      automationClient: automationClient as never,
      workerId: "trae-remote",
      repoDir: "/tmp/project",
      logger: { warn: vi.fn(), log: vi.fn() },
      sleep: vi.fn(async () => undefined),
      setIntervalImpl: vi.fn(() => ({}) as never),
      clearIntervalImpl: vi.fn(),
    });

    const result = await runtime.runOnce();

    expect(dispatcherClient.submitResult).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "dispatch-300:environment-only",
      status: "review_ready",
      summary: "no repo code change",
      filesChanged: [],
      github: expect.objectContaining({
        branchName: null,
        commitSha: null,
        pushStatus: "not_attempted",
      }),
      evidence: {
        blockers: [],
        findings: [],
        artifacts: expect.objectContaining({
          source: "chat_completion",
          conclusionType: "environment_only",
          environmentEvidence: "pnpm install fixed the missing workspace dependency\nsame checkout now resolves @forgeflow/result-contracts",
          noRepoCodeChange: "true",
        }),
      },
    }));
    expect(result).toEqual({
      status: "review_ready",
      taskId: "dispatch-300:environment-only",
      responseText: expect.stringContaining("## 任务完成"),
    });

    runtime.stop();
  });

  it("fails parsed success without code-change evidence or explicit environment_only proof", async () => {
    const dispatcherClient = {
      register: vi.fn(async () => ({})),
      fetchTask: vi.fn(async () => ({
        status: "task",
        task: {
          task_id: "dispatch-301:invalid-success",
          repo: "repo",
          branch: "feature/invalid-success",
          default_branch: "main",
          scope: ["packages/**"],
          acceptance: ["pnpm --filter @tingrudeng/trae-beta-runtime typecheck"],
          constraints: [],
          prompt: "Do not accept an empty success report",
          chat_mode: "new_chat",
        },
      })),
      startTask: vi.fn(async () => ({})),
      reportProgress: vi.fn(async () => ({})),
      submitResult: vi.fn(async () => ({})),
      heartbeat: vi.fn(async () => ({})),
    };
    const automationClient = {
      ready: vi.fn(async () => ({ ready: true })),
      prepareSession: vi.fn(async () => ({ data: { sessionId: "session-invalid-success" } })),
      sendChat: vi.fn(async () => ({
        response: {
          text: [
            "## 任务完成",
            "- 结果: 成功",
            "- 任务ID: dispatch-301:invalid-success",
            "- 修改文件: 无",
            "- 测试结果: pnpm --filter @tingrudeng/trae-beta-runtime typecheck",
            "- 风险: 无",
            "- GitHub 证据:",
            "  - branch: 无",
            "  - commit: 无",
            "  - push: 无",
            "  - push_error: 无",
            "  - PR: 无",
            "  - PR URL: 无",
            "- 备注: no further details",
          ].join("\n"),
        },
      })),
      releaseSession: vi.fn(async () => ({ data: { sessionId: "session-invalid-success", released: true } })),
    };

    const { createTraeAutomationWorkerRuntime } = await import("../../src/runtime/worker.js");
    const runtime = createTraeAutomationWorkerRuntime({
      dispatcherClient: dispatcherClient as never,
      automationClient: automationClient as never,
      workerId: "trae-remote",
      repoDir: "/tmp/project",
      logger: { warn: vi.fn(), log: vi.fn() },
      sleep: vi.fn(async () => undefined),
      setIntervalImpl: vi.fn(() => ({}) as never),
      clearIntervalImpl: vi.fn(),
    });

    const result = await runtime.runOnce();

    expect(dispatcherClient.submitResult).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "dispatch-301:invalid-success",
      status: "failed",
      summary: expect.stringContaining("missing code-change evidence"),
      evidence: expect.objectContaining({
        failureType: "unknown",
      }),
    }));
    expect(result).toEqual({
      status: "failed",
      taskId: "dispatch-301:invalid-success",
      responseText: expect.stringContaining("## 任务完成"),
    });

    runtime.stop();
  });
});
