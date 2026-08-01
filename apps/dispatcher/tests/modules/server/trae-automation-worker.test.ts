import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it, vi } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);
const workerModulePath = path.join(repoRoot, "scripts/lib/trae-automation-worker.js");

function runGit(args: string[], cwd: string) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  }
  return (result.stdout || "").trim();
}

const tempPaths: string[] = [];

function createRepoWithOrigin(prefix: string, defaultBranch = "main") {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const originDir = path.join(rootDir, "origin.git");
  const repoDir = path.join(rootDir, "repo");

  fs.mkdirSync(repoDir, { recursive: true });
  runGit(["init", "--bare", originDir], rootDir);
  runGit(["init", "-b", defaultBranch], repoDir);
  runGit(["config", "user.name", "ForgeFlow Test"], repoDir);
  runGit(["config", "user.email", "forgeflow@example.com"], repoDir);
  fs.writeFileSync(path.join(repoDir, "README.md"), "# repo\n");
  runGit(["add", "README.md"], repoDir);
  runGit(["commit", "-m", "init"], repoDir);
  runGit(["remote", "add", "origin", originDir], repoDir);
  runGit(["push", "-u", "origin", defaultBranch], repoDir);

  tempPaths.push(rootDir);
  return { repoDir, originDir, rootDir };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete process.env.FORGEFLOW_WORKER_REMOVE_WORKTREE_ON_EXIT;
  delete process.env.FORGEFLOW_WORKER_FORCE_WORKTREE_CLEANUP;
  delete process.env.WORKER_PROGRESS_MAX_ATTEMPTS;
  delete process.env.WORKER_PROGRESS_RETRY_DELAY_MS;
  while (tempPaths.length > 0) {
    const tempPath = tempPaths.pop();
    if (tempPath) {
      fs.rmSync(tempPath, { recursive: true, force: true });
    }
  }
});

describe("trae automation dispatcher heartbeat", () => {
  it("retries with one stable heartbeat payload", async () => {
    const mod = await import(workerModulePath);
    vi.useFakeTimers();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('{"error":"temporarily unavailable"}', { status: 503 }))
      .mockResolvedValueOnce(new Response('{"status":"ok"}', { status: 200 }));
    const dispatcher = mod.createDispatcherClient("http://127.0.0.1:8787", {
      fetchImpl,
    });

    const pending = dispatcher.heartbeat("trae-heartbeat");
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(pending).resolves.toEqual({ status: "ok" });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const firstBody = fetchImpl.mock.calls[0][1].body;
    const secondBody = fetchImpl.mock.calls[1][1].body;
    expect(secondBody).toBe(firstBody);
    expect(JSON.parse(firstBody)).toEqual({ worker_id: "trae-heartbeat" });
  });

  it("does not retry an invalid heartbeat response", async () => {
    const mod = await import(workerModulePath);
    const fetchImpl = vi.fn(async () => new Response("not-json", { status: 200 }));
    const dispatcher = mod.createDispatcherClient("http://127.0.0.1:8787", {
      fetchImpl,
    });

    await expect(dispatcher.heartbeat("trae-heartbeat")).rejects.toMatchObject({
      retryable: false,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("keeps scheduled heartbeat single-flight and cancels it on stop", async () => {
    const mod = await import(workerModulePath);
    const intervalHandlers: Array<() => Promise<void>> = [];
    const logger = { warn: vi.fn() };
    const heartbeat = vi.fn((
      _workerId: string,
      requestOptions: { signal?: AbortSignal } = {},
    ) => new Promise((_, reject) => {
      requestOptions.signal?.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    }));
    const dispatcherClient = {
      register: vi.fn(async () => ({ ok: true })),
      heartbeat,
    };
    const runtime = mod.createTraeAutomationWorkerRuntime({
      dispatcherClient,
      automationClient: {
        ready: vi.fn(async () => ({ data: { ready: true } })),
      },
      workerId: "trae-heartbeat",
      repoDir: "/tmp/repo",
      logger,
      setIntervalImpl: (handler: () => Promise<void>) => {
        intervalHandlers.push(handler);
        return intervalHandlers.length;
      },
      clearIntervalImpl: vi.fn(),
    });

    await runtime.register();
    const heartbeatTick = intervalHandlers[0];
    expect(heartbeatTick).toBeDefined();
    const firstTick = heartbeatTick!();
    await vi.waitFor(() => expect(heartbeat).toHaveBeenCalledOnce());
    await heartbeatTick!();

    expect(heartbeat).toHaveBeenCalledOnce();
    const signal = heartbeat.mock.calls[0]?.[1]?.signal;
    expect(signal).toBeDefined();
    runtime.stop();
    await firstTick;

    expect(signal!.aborted).toBe(true);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe("trae automation dispatcher cancellation", () => {
  it("propagates caller cancellation into fetchTask", async () => {
    const mod = await import(workerModulePath);
    const controller = new AbortController();
    const fetchImpl = vi.fn(async (_input, init) => {
      const signal = init?.signal as AbortSignal | undefined;
      await new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
        controller.abort();
      });
      return new Response("{}");
    });
    const dispatcher = mod.createDispatcherClient("http://127.0.0.1:8787", {
      fetchImpl,
    });

    await expect(dispatcher.fetchTask(
      "trae-cancel",
      "/tmp/repo",
      { signal: controller.signal },
    )).rejects.toMatchObject({ name: "AbortError" });

    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("propagates caller cancellation into startTask", async () => {
    const mod = await import(workerModulePath);
    const controller = new AbortController();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: "ok",
        task: {
          task_id: "task-start-cancel",
          attempt_id: "attempt-start-cancel",
          lease_token: "lease-start-cancel",
          protocol_version: "2026-05-v1",
          trace_id: "trace-start-cancel",
          idempotency_key: "worker-v1:task-start-cancel:attempt-start-cancel",
        },
      }), { status: 200 }))
      .mockImplementationOnce(async (_input, init) => {
        const signal = init?.signal as AbortSignal | undefined;
        await new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          }, { once: true });
          controller.abort();
        });
        return new Response("{}");
      });
    const dispatcher = mod.createDispatcherClient("http://127.0.0.1:8787", {
      fetchImpl,
    });

    await dispatcher.fetchTask("trae-cancel", "/tmp/repo");
    await expect(dispatcher.startTask(
      "trae-cancel",
      "task-start-cancel",
      { signal: controller.signal },
    )).rejects.toMatchObject({ name: "AbortError" });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("trae automation dispatcher progress", () => {
  it("retries with one stable progress_id", async () => {
    process.env.WORKER_PROGRESS_MAX_ATTEMPTS = "3";
    process.env.WORKER_PROGRESS_RETRY_DELAY_MS = "0";
    const mod = await import(workerModulePath);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: "ok",
        task: {
          task_id: "task-progress-retry",
          attempt_id: "attempt-progress-retry",
          lease_token: "lease-progress-retry",
          protocol_version: "2026-05-v1",
          trace_id: "trace-progress-retry",
          idempotency_key: "worker-v1:task-progress-retry:attempt-progress-retry",
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response('{"error":"temporarily unavailable"}', { status: 503 }))
      .mockResolvedValueOnce(new Response('{"status":"progress_recorded"}', { status: 200 }));
    const dispatcher = mod.createDispatcherClient("http://127.0.0.1:8787", {
      fetchImpl,
    });

    await dispatcher.fetchTask("trae-progress", "/tmp/repo");
    await dispatcher.reportProgress("task-progress-retry", "Running tests", "trae-progress");

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const firstAttempt = JSON.parse(fetchImpl.mock.calls[1][1].body);
    const secondAttempt = JSON.parse(fetchImpl.mock.calls[2][1].body);
    expect(secondAttempt).toEqual(firstAttempt);
    expect(firstAttempt.progress_id).toEqual(expect.any(String));
  });

  it("does not retry a progress protocol conflict", async () => {
    process.env.WORKER_PROGRESS_RETRY_DELAY_MS = "0";
    const mod = await import(workerModulePath);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: "ok",
        task: {
          task_id: "task-progress-conflict",
          attempt_id: "attempt-progress-conflict",
          lease_token: "lease-progress-conflict",
          protocol_version: "2026-05-v1",
          trace_id: "trace-progress-conflict",
          idempotency_key: "worker-v1:task-progress-conflict:attempt-progress-conflict",
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response("null", { status: 409 }));
    const dispatcher = mod.createDispatcherClient("http://127.0.0.1:8787", {
      fetchImpl,
    });

    await dispatcher.fetchTask("trae-progress", "/tmp/repo");
    await expect(dispatcher.reportProgress(
      "task-progress-conflict",
      "Running tests",
      "trae-progress",
    )).rejects.toMatchObject({ status: 409 });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry a progress response with invalid JSON", async () => {
    const mod = await import(workerModulePath);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: "ok",
        task: {
          task_id: "task-progress-invalid-json",
          attempt_id: "attempt-progress-invalid-json",
          lease_token: "lease-progress-invalid-json",
          protocol_version: "2026-05-v1",
          trace_id: "trace-progress-invalid-json",
          idempotency_key: "worker-v1:task-progress-invalid-json:attempt-progress-invalid-json",
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response("not-json", { status: 200 }));
    const dispatcher = mod.createDispatcherClient("http://127.0.0.1:8787", {
      fetchImpl,
    });

    await dispatcher.fetchTask("trae-progress", "/tmp/repo");
    await expect(dispatcher.reportProgress(
      "task-progress-invalid-json",
      "Running tests",
      "trae-progress",
    )).rejects.toMatchObject({ retryable: false });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("trae automation worker prompt and parsing", () => {
  it("builds an automation prompt with task metadata and the final template", async () => {
    const mod = await import(workerModulePath);

    const prompt = mod.buildAutomationPrompt({
      task_id: "dispatch-1:task-1",
      repo: "test/repo",
      branch: "ai/trae/task-1",
      goal: "Fix login errors",
      scope: ["src/auth/**"],
      constraints: ["do not expand scope"],
      acceptance: ["pnpm test", "pnpm typecheck"],
      prompt: "Fix the login error and keep tests passing.",
      worktree_dir: "/tmp/worktree",
      assignment_dir: "/tmp/assignment",
    });

    expect(prompt).toContain("任务ID: dispatch-1:task-1");
    expect(prompt).toContain("允许范围: src/auth/**");
    expect(prompt).toContain("pnpm test");
    expect(prompt).toContain("## 任务完成");
  }, 20_000);

  it("parses the final report template into a submit_result payload shape", async () => {
    const mod = await import(workerModulePath);

    const parsed = mod.parseFinalReport(`
## 任务完成
- 结果: 成功
- 任务ID: dispatch-1:task-1
- 修改文件: src/auth.ts, tests/auth.test.ts
- 测试结果: pnpm test passed
- 风险: 无
- GitHub 证据:
  - branch: ai/trae/task-1
  - commit: abc123
  - push: 成功
  - push_error: 无
  - PR: 42
  - PR URL: https://github.com/org/repo/pull/42
- 备注: 已完成
    `);

    expect(parsed.taskId).toBe("dispatch-1:task-1");
    expect(parsed.filesChanged).toEqual(["src/auth.ts", "tests/auth.test.ts"]);
    expect(parsed.github.pushStatus).toBe("success");
    expect(parsed.github.prNumber).toBe(42);
  });

  it("parses the rendered plain-text final report emitted by Trae", async () => {
    const mod = await import(workerModulePath);

    const parsed = mod.parseFinalReport(`
任务完成
结果: 成功
任务ID: dispatch-1:task-1
修改文件: src/auth.ts
测试结果: pnpm test passed
风险: 无
GitHub 证据:
branch: ai/trae/task-1
commit: abc123
push: success
push_error: 无
PR: 无
PR URL: 无
备注: 已完成
    `);

    expect(parsed.taskId).toBe("dispatch-1:task-1");
    expect(parsed.filesChanged).toEqual(["src/auth.ts"]);
    expect(parsed.github.branchName).toBe("ai/trae/task-1");
    expect(parsed.github.pushStatus).toBe("success");
  });

  it("derives discovery hints from worktree and repo paths", async () => {
    const mod = await import(workerModulePath);

    const hints = mod.deriveTaskDiscoveryHints(
      {
        worktree_dir: "/tmp/.worktrees/task-1-phase2-smoke",
        assignment_dir: "/tmp/.forgeflow-dispatcher/assignments/task-1-phase2-smoke",
      },
      "/repos/openclaw-multi-agent-mvp"
    );

    expect(hints).toEqual({
      titleContains: [
        "task-1-phase2-smoke",
        "openclaw-multi-agent-mvp",
      ],
    });
  });

  it("materializes task workspace locally under the worker repo dir", async () => {
    const mod = await import(workerModulePath);
    const { repoDir } = createRepoWithOrigin("forgeflow-trae-worker-", "master");
    const task = {
      task_id: "dispatch-1:task-1",
      repo: "test/repo",
      branch: "ai/trae/task-1",
      default_branch: "master",
      goal: "Fix login errors",
      scope: ["docs/**"],
      constraints: ["do not expand scope"],
      acceptance: ["pnpm test"],
      prompt: "Fix the login error and keep tests passing.",
    };

    const dirs = mod.materializeTaskWorkspace(task, repoDir);
    const worktreeName = path.basename(dirs.worktree_dir);

    expect(worktreeName).toMatch(/^dispatch-1-task-1-[0-9a-f]{12}$/);
    expect(dirs.worktree_dir).toBe(path.join(repoDir, ".worktrees", worktreeName));
    expect(dirs.assignment_dir).toBe(
      path.join(dirs.worktree_dir, ".orchestrator", "assignments", worktreeName)
    );
    expect(runGit(["branch", "--show-current"], dirs.worktree_dir)).toBe("ai/trae/task-1");
    expect(fs.existsSync(path.join(dirs.assignment_dir, "assignment.json"))).toBe(true);
    expect(fs.existsSync(path.join(dirs.assignment_dir, "worker-prompt.md"))).toBe(true);
    expect(fs.existsSync(path.join(dirs.assignment_dir, "context.md"))).toBe(true);
  });
});

describe("trae automation worker runtime", () => {
  it("runs one unattended task end-to-end in serial mode", async () => {
    const mod = await import(workerModulePath);
    const { repoDir } = createRepoWithOrigin("forgeflow-trae-runtime-", "main");

    const dispatcherClient = {
      register: vi.fn(async () => ({ ok: true })),
      heartbeat: vi.fn(async () => ({ ok: true })),
      fetchTask: vi.fn(async () => ({
        status: "ok",
        task: {
          task_id: "dispatch-1:task-1",
          repo: "test/repo",
          branch: "ai/trae/task-1",
          default_branch: "main",
          goal: "Fix login errors",
          scope: ["src/auth/**"],
          constraints: ["do not expand scope"],
          acceptance: ["pnpm test"],
          prompt: "Fix the login error and keep tests passing.",
          worktree_dir: "/tmp/worktree",
          assignment_dir: "/tmp/assignment",
          chat_mode: "new_chat",
        },
      })),
      startTask: vi.fn(async () => ({ ok: true })),
      reportProgress: vi.fn(async () => ({ ok: true })),
      submitResult: vi.fn(async () => ({ ok: true })),
    };

    const automationClient = {
      ready: vi.fn(async () => ({ data: { ready: true } })),
      prepareSession: vi.fn(async () => ({ data: { sessionId: "session-end-to-end" } })),
      sendChat: vi.fn(async () => ({
        data: {
          response: {
            text: `
## 任务完成
- 结果: 成功
- 任务ID: dispatch-1:task-1
- 修改文件: src/auth.ts
- 测试结果: pnpm test passed
- 风险: 无
- GitHub 证据:
  - branch: ai/trae/task-1
  - commit: abc123
  - push: success
  - push_error: 无
  - PR: 无
  - PR URL: 无
- 备注: 已完成
            `,
          },
        },
      })),
    };

    const intervals: Array<() => Promise<void> | void> = [];
    const runtime = mod.createTraeAutomationWorkerRuntime({
      dispatcherClient,
      automationClient,
      workerId: "trae-auto-1",
      repoDir,
      pollIntervalMs: 1,
      setIntervalImpl: (handler: () => void) => {
        intervals.push(handler);
        return intervals.length;
      },
      clearIntervalImpl: () => {},
      sleep: async () => {},
      logger: { warn: vi.fn() },
      checkArtifactReviewabilityImpl: () => ({
        reviewable: true,
        reason: "Artifact is reviewable",
        evidence: {
          worktreeExists: true,
          branchMatches: true,
          hasChanges: true,
          allChangesInScope: true,
          remoteVerified: true,
          remoteHeadSha: "abc123",
          branchName: "ai/trae/task-1",
          commitSha: "abc123",
          filesChanged: ["src/auth.ts"],
          outOfScopeFiles: [],
          uncommittedFiles: [],
          remoteCheckReason: "Remote branch HEAD matches reported commit",
        },
      }),
    });

    await runtime.register();
    const controller = new AbortController();
    const result = await runtime.runOnce(controller.signal);

    expect(result.status).toBe("review_ready");
    expect(dispatcherClient.fetchTask).toHaveBeenCalledWith(
      "trae-auto-1",
      repoDir,
      { signal: controller.signal },
    );
    expect(dispatcherClient.startTask).toHaveBeenCalledWith(
      "trae-auto-1",
      "dispatch-1:task-1",
      { signal: controller.signal },
    );
    expect(dispatcherClient.submitResult).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "dispatch-1:task-1",
        status: "review_ready",
        filesChanged: ["src/auth.ts"],
      })
    );
    expect(automationClient.prepareSession).toHaveBeenCalledWith(
      expect.objectContaining({ chatMode: "new_chat" })
    );
    expect(automationClient.prepareSession).toHaveBeenCalled();
    expect(automationClient.sendChat).toHaveBeenCalledWith(
      expect.objectContaining({
        prepare: false,
        sessionId: "session-end-to-end",
        chatMode: "new_chat",
        discovery: {
          titleContains: [expect.stringContaining("dispatch-1-task-1"), "repo"],
        },
        responseRequiredPrefix: "任务完成",
        responseTimeoutMs: 1800000,
        timeoutMs: 1830000,
      })
    );
  });

  it("preserves unacknowledged worktree contents and releases the local owner", async () => {
    process.env.FORGEFLOW_WORKER_REMOVE_WORKTREE_ON_EXIT = "1";
    const mod = await import(workerModulePath);
    const { repoDir } = createRepoWithOrigin("forgeflow-trae-delivery-failure-", "main");
    const taskId = "dispatch-submit-failure";
    const dispatcherClient = {
      register: vi.fn(async () => ({ ok: true })),
      heartbeat: vi.fn(async () => ({ ok: true })),
      fetchTask: vi.fn(async () => ({
        status: "ok",
        task: {
          task_id: taskId,
          repo: "test/repo",
          branch: "ai/trae/submit-failure",
          default_branch: "main",
          scope: ["src/**"],
          constraints: [],
          acceptance: ["pnpm test"],
          prompt: "Preserve the worktree when delivery is unacknowledged",
        },
      })),
      startTask: vi.fn(async () => ({ ok: true })),
      reportProgress: vi.fn(async () => ({ ok: true })),
      submitResult: vi.fn(async () => {
        throw new Error("dispatcher unavailable");
      }),
    };
    const automationClient = {
      ready: vi.fn(async () => ({ data: { ready: true } })),
      prepareSession: vi.fn(async () => ({ data: { sessionId: "session-delivery-failure" } })),
      sendChat: vi.fn(async () => ({
        data: {
          response: {
            text: [
              "## 任务完成",
              "- 结果: 失败",
              `- 任务ID: ${taskId}`,
              "- 修改文件: src/failure.ts",
              "- 测试结果: dispatcher unavailable",
              "- 风险: result not acknowledged",
              "- GitHub 证据:",
              "  - branch: ai/trae/submit-failure",
              "  - commit: 无",
              "  - push: 无",
              "  - push_error: dispatcher unavailable",
              "  - PR: 无",
              "  - PR URL: 无",
              "- 备注: preserve local evidence",
            ].join("\n"),
          },
        },
      })),
    };
    const runtime = mod.createTraeAutomationWorkerRuntime({
      dispatcherClient,
      automationClient,
      workerId: "trae-delivery-failure",
      repoDir,
      setIntervalImpl: () => 1,
      clearIntervalImpl: () => {},
      sleep: async () => {},
      logger: { warn: vi.fn() },
      checkArtifactReviewabilityImpl: () => ({
        reviewable: false,
        reason: "no reviewable remote artifact",
        evidence: {
          worktreeExists: true,
          branchMatches: true,
          hasChanges: false,
          allChangesInScope: true,
          remoteVerified: false,
          remoteHeadSha: null,
          branchName: "ai/trae/submit-failure",
          commitSha: null,
          filesChanged: [],
          outOfScopeFiles: [],
          uncommittedFiles: [],
          remoteCheckReason: "result not acknowledged",
        },
      }),
    });

    await expect(runtime.runOnce()).rejects.toThrow("dispatcher unavailable");

    expect(dispatcherClient.submitResult).toHaveBeenCalledTimes(2);
    expect(fs.existsSync(path.join(repoDir, ".worktrees", taskId))).toBe(true);
    expect(fs.existsSync(path.join(repoDir, ".git", "forgeflow-worktree-owner.lock"))).toBe(false);
  });

  it("returns no_task when dispatcher has nothing pending", async () => {
    const mod = await import(workerModulePath);

    const runtime = mod.createTraeAutomationWorkerRuntime({
      dispatcherClient: {
        register: vi.fn(async () => ({ ok: true })),
        heartbeat: vi.fn(async () => ({ ok: true })),
        fetchTask: vi.fn(async () => ({ status: "no_task" })),
        startTask: vi.fn(async () => ({ ok: true })),
        reportProgress: vi.fn(async () => ({ ok: true })),
        submitResult: vi.fn(async () => ({ ok: true })),
      },
      automationClient: {
        ready: vi.fn(async () => ({ data: { ready: true } })),
        sendChat: vi.fn(),
      },
      workerId: "trae-auto-2",
      repoDir: "/repos/test",
      setIntervalImpl: () => 1,
      clearIntervalImpl: () => {},
      sleep: async () => {},
      logger: { warn: vi.fn() },
    });

    const result = await runtime.runOnce();
    expect(result.status).toBe("no_task");
  });

  it("checks readiness against the registered repo basename", async () => {
    const mod = await import(workerModulePath);
    const automationClient = {
      ready: vi.fn(async () => ({ data: { ready: true } })),
      sendChat: vi.fn(),
    };

    const runtime = mod.createTraeAutomationWorkerRuntime({
      dispatcherClient: {
        register: vi.fn(async () => ({ ok: true })),
        heartbeat: vi.fn(async () => ({ ok: true })),
        fetchTask: vi.fn(async () => ({ status: "no_task" })),
        startTask: vi.fn(async () => ({ ok: true })),
        reportProgress: vi.fn(async () => ({ ok: true })),
        submitResult: vi.fn(async () => ({ ok: true })),
      },
      automationClient,
      workerId: "trae-auto-4",
      repoDir: "/repos/openclaw-multi-agent-mvp",
      setIntervalImpl: () => 1,
      clearIntervalImpl: () => {},
      sleep: async () => {},
      logger: { warn: vi.fn() },
    });

    await runtime.register();

    expect(automationClient.ready).toHaveBeenCalledWith({
      discovery: {
        titleContains: ["openclaw-multi-agent-mvp"],
      },
    });
  });

  it("retries gateway readiness until the automation target becomes ready", async () => {
    const mod = await import(workerModulePath);
    const warn = vi.fn();
    const sleep = vi.fn(async () => {});
    const readinessResponses = [
      { data: { ready: false }, error: { code: "AUTOMATION_NOT_READY" } },
      { data: { ready: false }, error: { code: "AUTOMATION_NOT_READY" } },
      { data: { ready: true } },
    ];
    const automationClient = {
      ready: vi.fn(async () => readinessResponses.shift() ?? { data: { ready: true } }),
    };
    const nowValues = [0, 0, 1000, 1000, 2000, 2000];
    const now = vi.fn(() => nowValues.shift() ?? 2000);

    const readiness = await mod.waitForAutomationGatewayReady({
      automationClient,
      repoDir: "/repos/openclaw-multi-agent-mvp",
      retryIntervalMs: 1000,
      timeoutMs: 5000,
      sleep,
      logger: { warn },
      now,
    });

    expect(readiness.data.ready).toBe(true);
    expect(automationClient.ready).toHaveBeenCalledTimes(3);
    expect(automationClient.ready).toHaveBeenCalledWith({
      discovery: {
        titleContains: ["openclaw-multi-agent-mvp"],
      },
    });
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("attempt 1 not ready"));
  });

  it("surfaces a startup error after the readiness window is exhausted", async () => {
    const mod = await import(workerModulePath);
    const automationClient = {
      ready: vi.fn(async () => ({ data: { ready: false }, error: { code: "AUTOMATION_NOT_READY" } })),
    };
    const sleep = vi.fn(async () => {});
    const nowValues = [0, 0, 1500, 1500];
    const now = vi.fn(() => nowValues.shift() ?? 1500);

    await expect(mod.waitForAutomationGatewayReady({
      automationClient,
      repoDir: "/repos/openclaw-multi-agent-mvp",
      retryIntervalMs: 1000,
      timeoutMs: 1500,
      sleep,
      logger: { warn: vi.fn() },
      now,
    })).rejects.toThrow("Trae automation gateway is not ready: AUTOMATION_NOT_READY");

    expect(automationClient.ready).toHaveBeenCalledTimes(1);
  });

  it("keeps polling after transient loop errors with backoff", async () => {
    const mod = await import(workerModulePath);
    const warn = vi.fn();
    const controller = { aborted: false };
    const sleep = vi.fn(async () => {
      controller.aborted = true;
    });

    const runtime = mod.createTraeAutomationWorkerRuntime({
      dispatcherClient: {
        register: vi.fn(async () => ({ ok: true })),
        heartbeat: vi.fn(async () => ({ ok: true })),
        fetchTask: vi
          .fn()
          .mockRejectedValueOnce(new Error("dispatcher offline"))
          .mockResolvedValueOnce({ status: "no_task" }),
        startTask: vi.fn(async () => ({ ok: true })),
        reportProgress: vi.fn(async () => ({ ok: true })),
        submitResult: vi.fn(async () => ({ ok: true })),
      },
      automationClient: {
        ready: vi.fn(async () => ({ data: { ready: true } })),
        sendChat: vi.fn(),
      },
      workerId: "trae-auto-3",
      repoDir: "/repos/test",
      errorBackoffMs: 7,
      maxErrorBackoffMs: 20,
      setIntervalImpl: () => 1,
      clearIntervalImpl: () => {},
      sleep,
      logger: { warn },
    });

    await runtime.runLoop(controller);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("dispatcher offline"));
    expect(sleep).toHaveBeenCalledWith(7);
  });

  it("polls session status on soft timeout and replays cached response", async () => {
    const mod = await import(workerModulePath);
    const { repoDir } = createRepoWithOrigin("forgeflow-trae-timeout-", "main");

    const dispatcherClient = {
      register: vi.fn(async () => ({ ok: true })),
      heartbeat: vi.fn(async () => ({ ok: true })),
      fetchTask: vi.fn(async () => ({
        status: "ok",
        task: {
          task_id: "dispatch-2:task-1",
          repo: "test/repo",
          branch: "ai/trae/task-1",
          default_branch: "main",
          goal: "Fix errors",
          scope: ["src/**"],
          constraints: [],
          acceptance: ["pnpm test"],
          prompt: "Fix errors",
          worktree_dir: "/tmp/worktree",
          assignment_dir: "/tmp/assignment",
        },
      })),
      startTask: vi.fn(async () => ({ ok: true })),
      reportProgress: vi.fn(async () => ({ ok: true })),
      submitResult: vi.fn(async () => ({ ok: true })),
    };

    let chatCallCount = 0;
    const automationClient = {
      ready: vi.fn(async () => ({ data: { ready: true } })),
      prepareSession: vi.fn(async () => ({ data: { sessionId: "session-123" } })),
      getSession: vi.fn(async () => ({ data: { status: "completed" } })),
      sendChat: vi.fn(async () => {
        chatCallCount += 1;
        if (chatCallCount === 1) {
          throw new Error("request timeout: /v1/chat");
        }
        return {
          data: {
            response: {
              text: `
## 任务完成
- 结果: 成功
- 任务ID: dispatch-2:task-1
- 修改文件: src/recovered.js
- 测试结果: cached replay
- 风险: 无
- GitHub 证据:
  - branch: ai/trae/task-1
  - commit: abc123
  - push: success
  - push_error: 无
  - PR: 无
  - PR URL: 无
- 备注: cached
              `,
            },
          },
        };
      }),
    };

    const runtime = mod.createTraeAutomationWorkerRuntime({
      dispatcherClient,
      automationClient,
      workerId: "trae-timeout-1",
      repoDir,
      setIntervalImpl: () => 1,
      clearIntervalImpl: () => {},
      sleep: async () => {},
      logger: { warn: vi.fn() },
      checkArtifactReviewabilityImpl: () => ({
        reviewable: true,
        reason: "Artifact is reviewable",
        evidence: {
          worktreeExists: true,
          branchMatches: true,
          hasChanges: true,
          allChangesInScope: true,
          remoteVerified: true,
          remoteHeadSha: "abc123",
          branchName: "ai/trae/task-1",
          commitSha: "abc123",
          filesChanged: ["src/recovered.js"],
          outOfScopeFiles: [],
          uncommittedFiles: [],
          remoteCheckReason: "Remote branch HEAD matches reported commit",
        },
      }),
    });

    const result = await runtime.runOnce();

    expect(result.status).toBe("review_ready");
    expect(automationClient.prepareSession).toHaveBeenCalled();
    expect(automationClient.getSession).toHaveBeenCalled();
    expect(automationClient.sendChat).toHaveBeenCalledTimes(2);
  });

  it("fails when session status is interrupted", async () => {
    const mod = await import(workerModulePath);
    const { repoDir } = createRepoWithOrigin("forgeflow-trae-timeout-", "main");

    const dispatcherClient = {
      register: vi.fn(async () => ({ ok: true })),
      heartbeat: vi.fn(async () => ({ ok: true })),
      fetchTask: vi.fn(async () => ({
        status: "ok",
        task: {
          task_id: "dispatch-3:task-1",
          repo: "test/repo",
          branch: "ai/trae/task-1",
          default_branch: "main",
          goal: "Fix errors",
          scope: ["src/**"],
          constraints: [],
          acceptance: ["pnpm test"],
          prompt: "Fix errors",
          worktree_dir: "/tmp/worktree",
          assignment_dir: "/tmp/assignment",
        },
      })),
      startTask: vi.fn(async () => ({ ok: true })),
      reportProgress: vi.fn(async () => ({ ok: true })),
      submitResult: vi.fn(async () => ({ ok: true })),
    };

    const automationClient = {
      ready: vi.fn(async () => ({ data: { ready: true } })),
      prepareSession: vi.fn(async () => ({ data: { sessionId: "session-456" } })),
      getSession: vi.fn(async () => ({ data: { status: "interrupted", error: "Gateway restarted" } })),
      sendChat: vi.fn(async () => {
        throw new Error("request timeout: /v1/chat");
      }),
    };

    const runtime = mod.createTraeAutomationWorkerRuntime({
      dispatcherClient,
      automationClient,
      workerId: "trae-timeout-2",
      repoDir,
      setIntervalImpl: () => 1,
      clearIntervalImpl: () => {},
      sleep: async () => {},
      logger: { warn: vi.fn() },
    });

    const result = await runtime.runOnce();

    expect(result.status).toBe("failed");
    expect(result.error).toContain("Gateway restarted");
    expect(dispatcherClient.submitResult).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
      })
    );
  });
});
