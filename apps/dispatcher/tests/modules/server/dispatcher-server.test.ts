import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);
const serverModulePath = path.join(repoRoot, "scripts/lib/dispatcher-server.js");
const tempRoots: string[] = [];

const originalEnv = process.env.DISPATCHER_API_TOKEN;
const originalAuthMode = process.env.DISPATCHER_AUTH_MODE;
const originalStateLockTimeout = process.env.DISPATCHER_STATE_LOCK_TIMEOUT_MS;
const originalStateLockRetry = process.env.DISPATCHER_STATE_LOCK_RETRY_MS;
const originalStateLockStale = process.env.DISPATCHER_STATE_LOCK_STALE_MS;

function makeTempDir() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-dispatcher-server-"));
  tempRoots.push(tempDir);
  return tempDir;
}

beforeAll(() => {
  process.env.DISPATCHER_AUTH_MODE = "open";
});

afterEach(() => {
  for (const tempDir of tempRoots.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  if (originalEnv === undefined) {
    delete process.env.DISPATCHER_API_TOKEN;
  } else {
    process.env.DISPATCHER_API_TOKEN = originalEnv;
  }
  if (originalAuthMode === undefined) {
    delete process.env.DISPATCHER_AUTH_MODE;
  } else {
    process.env.DISPATCHER_AUTH_MODE = originalAuthMode;
  }
  if (originalStateLockTimeout === undefined) {
    delete process.env.DISPATCHER_STATE_LOCK_TIMEOUT_MS;
  } else {
    process.env.DISPATCHER_STATE_LOCK_TIMEOUT_MS = originalStateLockTimeout;
  }
  if (originalStateLockRetry === undefined) {
    delete process.env.DISPATCHER_STATE_LOCK_RETRY_MS;
  } else {
    process.env.DISPATCHER_STATE_LOCK_RETRY_MS = originalStateLockRetry;
  }
  if (originalStateLockStale === undefined) {
    delete process.env.DISPATCHER_STATE_LOCK_STALE_MS;
  } else {
    process.env.DISPATCHER_STATE_LOCK_STALE_MS = originalStateLockStale;
  }
  process.env.DISPATCHER_AUTH_MODE = "open";
});

describe("dispatcher server", () => {
  it("serves worker, dispatch, result, review, and dashboard endpoints", async () => {
    const stateDir = makeTempDir();
    const mod = await import(serverModulePath);
    const registerResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/register",
      body: {
        workerId: "codex-mac-mini",
        pool: "codex",
        hostname: "mac-mini",
        labels: ["mac"],
        repoDir: "/repos/openclaw",
      },
    });
    expect(registerResponse.status).toBe(200);

    const heartbeatResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/codex-mac-mini/heartbeat",
      body: {},
    });
    expect(heartbeatResponse.status).toBe(200);

    const dispatchResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/dispatches",
      body: {
        repo: "TingRuDeng/openclaw-multi-agent-mvp",
        defaultBranch: "master",
        requestedBy: "codex-control",
        tasks: [
          {
            id: "task-1",
            title: "实现后端鉴权 API",
            pool: "codex",
            allowedPaths: ["src/**", "tests/**"],
            acceptance: ["返回 token"],
            dependsOn: [],
            branchName: "ai/codex/task-1-auth-api",
            verification: { mode: "run" },
          },
        ],
        packages: [
          {
            taskId: "task-1",
            assignment: {
              taskId: "task-1",
              workerId: "placeholder",
              pool: "codex",
              status: "assigned",
              branchName: "ai/codex/task-1-auth-api",
              allowedPaths: ["src/**", "tests/**"],
              commands: {
                test: "pnpm test",
              },
              repo: "TingRuDeng/openclaw-multi-agent-mvp",
              defaultBranch: "master",
            },
            workerPrompt: "你是 codex-worker。",
            contextMarkdown: "# Context",
          },
        ],
      },
    });
    expect(dispatchResponse.status).toBe(200);
    const dispatchBody = dispatchResponse.json;
    expect(dispatchBody.assignments[0]).toMatchObject({
      workerId: "codex-mac-mini",
      status: "assigned",
    });

    const assignedTaskResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/api/workers/codex-mac-mini/assigned-task",
    });
    expect(assignedTaskResponse.status).toBe(200);
    expect(assignedTaskResponse.headers["cache-control"]).toBe("no-store");
    const assignedTaskBody = assignedTaskResponse.json;
    expect(assignedTaskBody.assignment.workerId).toBe("codex-mac-mini");

    const resultResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/codex-mac-mini/result",
      body: {
        result: {
          taskId: dispatchBody.taskIds[0],
          workerId: "codex-mac-mini",
          provider: "codex",
          pool: "codex",
          branchName: "ai/codex/task-1-auth-api",
          repo: "TingRuDeng/openclaw-multi-agent-mvp",
          defaultBranch: "master",
          mode: "run",
          output: "done",
          generatedAt: "2026-03-16T11:00:00.000Z",
          verification: {
            allPassed: true,
            commands: [
              {
                command: "pnpm test",
                exitCode: 0,
                output: "ok",
              },
            ],
          },
        },
        changedFiles: ["src/auth.ts"],
        pullRequest: {
          number: 15,
          url: "https://github.com/TingRuDeng/openclaw-multi-agent-mvp/pull/15",
          headBranch: "ai/codex/task-1-auth-api",
          baseBranch: "master",
        },
      },
    });
    expect(resultResponse.status).toBe(200);

    const decisionResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: `/api/reviews/${dispatchBody.taskIds[0]}/decision`,
      body: {
        actor: "codex-control",
        decision: "merge",
        notes: "looks good",
      },
    });
    expect(decisionResponse.status).toBe(200);

    const snapshotResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/api/dashboard/snapshot",
    });
    expect(snapshotResponse.status).toBe(200);
    const snapshot = snapshotResponse.json;
    expect(snapshot.stats.workers.total).toBe(1);
    expect(snapshot.tasks[0]).toMatchObject({
      status: "merged",
    });
    expect(snapshot.pullRequests[0]).toMatchObject({
      number: 15,
      status: "merged",
    });

    const dashboardResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/dashboard",
    });
    expect(dashboardResponse.status).toBe(200);
    expect(dashboardResponse.headers["cache-control"]).toBe("no-store");
    const dashboardHtml = dashboardResponse.text;
    expect(dashboardHtml).toContain("ForgeFlow");
  }, 15_000);

  it("exports control-plane metrics via a dedicated no-store endpoint", async () => {
    const stateDir = makeTempDir();
    const mod = await import(serverModulePath);

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/dispatches",
      body: {
        repo: "test/repo",
        defaultBranch: "main",
        requestedBy: "test",
        tasks: [
          {
            id: "task-ready",
            title: "Ready task",
            pool: "codex",
            allowedPaths: ["docs/**"],
            acceptance: [],
            dependsOn: [],
            branchName: "ai/codex/task-ready",
          },
          {
            id: "task-planned",
            title: "Planned task",
            pool: "codex",
            allowedPaths: ["docs/**"],
            acceptance: [],
            dependsOn: ["dispatch-1:task-ready"],
            branchName: "ai/codex/task-planned",
          },
        ],
        packages: [
          {
            taskId: "task-ready",
            assignment: {
              taskId: "task-ready",
              workerId: null,
              pool: "codex",
              status: "pending",
              branchName: "ai/codex/task-ready",
              allowedPaths: ["docs/**"],
              repo: "test/repo",
              defaultBranch: "main",
            },
          },
          {
            taskId: "task-planned",
            assignment: {
              taskId: "task-planned",
              workerId: null,
              pool: "codex",
              status: "pending",
              branchName: "ai/codex/task-planned",
              allowedPaths: ["docs/**"],
              repo: "test/repo",
              defaultBranch: "main",
            },
          },
        ],
      },
    });

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/register",
      body: {
        workerId: "codex-metrics",
        pool: "codex",
        hostname: "metrics-host",
        labels: [],
        repoDir: "/repo",
      },
    });

    const response = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/api/metrics",
    });

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json).toMatchObject({
      queueDepth: 1,
      plannedTasks: 1,
      reviewBacklog: 0,
      workers: {
        total: 1,
      },
      tasks: {
        total: 2,
        ready: 1,
      },
    });
  });

  it("returns 404 when review decision task does not exist", async () => {
    const stateDir = makeTempDir();
    const mod = await import(serverModulePath);

    const response = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/reviews/nonexistent-task/decision",
      body: {
        actor: "codex-control",
        decision: "merge",
        notes: "probe",
      },
    });

    expect(response.status).toBe(404);
    expect(response.json).toEqual({
      error: "task not found: nonexistent-task",
    });
  });

  it("returns 400 when review decision actor is missing", async () => {
    const stateDir = makeTempDir();
    const mod = await import(serverModulePath);

    const response = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/reviews/nonexistent-task/decision",
      body: {
        decision: "merge",
        notes: "probe",
      },
    });

    expect(response.status).toBe(400);
    expect(response.json).toEqual({
      error: "review decision actor is required",
    });
  });

  it("returns 400 when review decision value is invalid", async () => {
    const stateDir = makeTempDir();
    const mod = await import(serverModulePath);

    const response = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/reviews/nonexistent-task/decision",
      body: {
        actor: "codex-control",
        decision: "approve",
      },
    });

    expect(response.status).toBe(400);
    expect(response.json).toEqual({
      error: "invalid review decision: approve",
    });
  });

  it("returns 503 when a state mutation route cannot acquire the runtime lock", async () => {
    const stateDir = makeTempDir();
    const mod = await import(serverModulePath);
    process.env.DISPATCHER_STATE_LOCK_TIMEOUT_MS = "1";
    process.env.DISPATCHER_STATE_LOCK_RETRY_MS = "1";

    const lockPath = mod.getStateLockFilePath
      ? mod.getStateLockFilePath(stateDir)
      : path.join(stateDir, ".runtime-state.lock");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(lockPath, "held");

    const response = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/register",
      body: {
        workerId: "codex-lock",
        pool: "codex",
        hostname: "host",
        labels: [],
        repoDir: "/repo",
      },
    });

    expect(response.status).toBe(503);
    expect(response.json.error).toContain("state lock timeout");
  });

  it("applies the same runtime lock to Trae write routes", async () => {
    const stateDir = makeTempDir();
    const mod = await import(serverModulePath);
    process.env.DISPATCHER_STATE_LOCK_TIMEOUT_MS = "1";
    process.env.DISPATCHER_STATE_LOCK_RETRY_MS = "1";

    const lockPath = mod.getStateLockFilePath
      ? mod.getStateLockFilePath(stateDir)
      : path.join(stateDir, ".runtime-state.lock");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(lockPath, "held");

    const response = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/heartbeat",
      body: {
        worker_id: "trae-lock",
      },
    });

    expect(response.status).toBe(503);
    expect(response.json.error).toContain("state lock timeout");
  });

  it("reclaims a stale runtime lock before mutating state", async () => {
    const stateDir = makeTempDir();
    const mod = await import(serverModulePath);
    process.env.DISPATCHER_STATE_LOCK_TIMEOUT_MS = "25";
    process.env.DISPATCHER_STATE_LOCK_RETRY_MS = "1";
    process.env.DISPATCHER_STATE_LOCK_STALE_MS = "1";

    const lockPath = mod.getStateLockFilePath
      ? mod.getStateLockFilePath(stateDir)
      : path.join(stateDir, ".runtime-state.lock");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(lockPath, "stale");
    const staleAt = new Date(Date.now() - 10_000);
    fs.utimesSync(lockPath, staleAt, staleAt);

    const response = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/register",
      body: {
        workerId: "codex-stale-lock",
        pool: "codex",
        hostname: "host",
        labels: [],
        repoDir: "/repo",
      },
    });

    expect(response.status).toBe(200);
    expect(response.json.status).toBe("registered");
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("returns 409 when review decision task is not in review", async () => {
    const stateDir = makeTempDir();
    const mod = await import(serverModulePath);

    const dispatchResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/dispatches",
      body: {
        repo: "TingRuDeng/openclaw-multi-agent-mvp",
        defaultBranch: "master",
        requestedBy: "codex-control",
        tasks: [
          {
            id: "task-not-in-review",
            title: "未进入 review 的任务",
            pool: "codex",
            allowedPaths: ["src/**"],
            acceptance: ["pnpm test"],
            dependsOn: [],
            branchName: "ai/codex/task-not-in-review",
            verification: { mode: "run" },
          },
        ],
        packages: [
          {
            taskId: "task-not-in-review",
            assignment: {
              taskId: "task-not-in-review",
              workerId: null,
              pool: "codex",
              status: "pending",
              branchName: "ai/codex/task-not-in-review",
              allowedPaths: ["src/**"],
              repo: "TingRuDeng/openclaw-multi-agent-mvp",
              defaultBranch: "master",
            },
            workerPrompt: "你是 codex-worker。",
            contextMarkdown: "# Context",
          },
        ],
      },
    });
    expect(dispatchResponse.status).toBe(200);

    const taskId = dispatchResponse.json.taskIds[0];
    const response = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: `/api/reviews/${taskId}/decision`,
      body: {
        actor: "codex-control",
        decision: "merge",
        notes: "probe",
      },
    });

    expect(response.status).toBe(409);
    expect(response.json).toEqual({
      error: `task not in review: ${taskId}`,
    });
  });

  it("fetch_task returns no_task when no task assigned", async () => {
    const stateDir = makeTempDir();
    const mod = await import(serverModulePath);

    const response = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/fetch-task",
      body: { worker_id: "trae-01" },
    });
    expect(response.status).toBe(200);
    expect(response.json.status).toBe("no_task");
  });

  it("keeps GET assigned-task read-only and moves claim side effects to POST", async () => {
    const stateDir = makeTempDir();
    const mod = await import(serverModulePath);

    const dispatchResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/dispatches",
      body: {
        repo: "test/repo",
        defaultBranch: "main",
        requestedBy: "test",
        tasks: [
          {
            id: "task-claim",
            title: "Claim me",
            pool: "codex",
            allowedPaths: ["docs/**"],
            acceptance: [],
            dependsOn: [],
            branchName: "ai/codex/task-claim",
          },
        ],
        packages: [
          {
            taskId: "task-claim",
            assignment: {
              taskId: "task-claim",
              workerId: null,
              pool: "codex",
              status: "pending",
              branchName: "ai/codex/task-claim",
              allowedPaths: ["docs/**"],
              repo: "test/repo",
              defaultBranch: "main",
            },
          },
        ],
      },
    });
    const taskId = dispatchResponse.json.taskIds[0];

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/register",
      body: {
        workerId: "codex-claim",
        pool: "codex",
        hostname: "claim-host",
        labels: [],
        repoDir: "/repo",
      },
    });

    const peekResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/api/workers/codex-claim/assigned-task",
    });
    expect(peekResponse.status).toBe(200);
    expect(peekResponse.json).toEqual({ assignment: null });

    const beforeClaim = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/api/dashboard/snapshot",
    });
    const readyTask = beforeClaim.json.tasks.find((item: { id: string }) => item.id === taskId);
    expect(readyTask.status).toBe("ready");

    const claimResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/codex-claim/claim-task",
      body: {},
    });
    expect(claimResponse.status).toBe(200);
    expect(claimResponse.json.assignment.workerId).toBe("codex-claim");

    const afterClaim = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/api/dashboard/snapshot",
    });
    const assignedTask = afterClaim.json.tasks.find((item: { id: string }) => item.id === taskId);
    expect(assignedTask.status).toBe("assigned");
  });

  it("rejects worker result metadata that does not match dispatcher truth", async () => {
    const stateDir = makeTempDir();
    const mod = await import(serverModulePath);

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/register",
      body: {
        workerId: "codex-canonical",
        pool: "codex",
        hostname: "canonical-host",
        labels: [],
        repoDir: "/repo",
      },
    });

    const dispatchResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/dispatches",
      body: {
        repo: "test/repo",
        defaultBranch: "main",
        requestedBy: "test",
        tasks: [
          {
            id: "task-result",
            title: "Canonical result",
            pool: "codex",
            allowedPaths: ["src/**"],
            acceptance: ["pnpm test"],
            dependsOn: [],
            branchName: "ai/codex/task-result",
            verification: { mode: "run" },
          },
        ],
        packages: [
          {
            taskId: "task-result",
            assignment: {
              taskId: "task-result",
              workerId: "codex-canonical",
              pool: "codex",
              status: "assigned",
              branchName: "ai/codex/task-result",
              allowedPaths: ["src/**"],
              repo: "test/repo",
              defaultBranch: "main",
            },
          },
        ],
      },
    });
    const taskId = dispatchResponse.json.taskIds[0];

    const response = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/codex-canonical/result",
      body: {
        result: {
          taskId,
          workerId: "codex-canonical",
          provider: "codex",
          pool: "codex",
          branchName: "ai/codex/task-result",
          repo: "test/other-repo",
          defaultBranch: "main",
          mode: "run",
          output: "done",
          generatedAt: "2026-04-07T00:00:00.000Z",
          verification: {
            allPassed: true,
            commands: [],
          },
        },
        changedFiles: [],
        pullRequest: null,
      },
    });

    expect(response.status).toBe(409);
    expect(response.json.error).toBe(`worker result repo mismatch for ${taskId}`);
  });

  it("submit_result rejects invalid status", async () => {
    const stateDir = makeTempDir();
    const mod = await import(serverModulePath);

    const response = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/submit-result",
      body: { task_id: "dispatch-1:task-1", status: "invalid_status" },
    });
    expect(response.status).toBe(400);
  });

  it("fetch_task returns task when assigned to trae worker", async () => {
    const stateDir = makeTempDir();
    const repoDir = path.join(stateDir, "repo");
    fs.mkdirSync(repoDir, { recursive: true });
    const mod = await import(serverModulePath);

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/heartbeat",
      body: { worker_id: "trae-01" },
    });

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/dispatches",
      body: {
        repo: "test/repo",
        defaultBranch: "main",
        requestedBy: "test",
        tasks: [
          {
            id: "task-1",
            title: "Test task",
            pool: "trae",
            allowedPaths: ["docs/**"],
            acceptance: ["pnpm test"],
            dependsOn: [],
            branchName: "ai/trae/task-1",
          },
        ],
        packages: [
          {
            taskId: "task-1",
            assignment: {
              taskId: "task-1",
              workerId: "trae-01",
              pool: "trae",
              status: "assigned",
              branchName: "ai/trae/task-1",
              allowedPaths: ["docs/**"],
              repo: "test/repo",
              defaultBranch: "main",
            },
            workerPrompt: "Test prompt",
            workerPromptMode: "auto",
            reportSchemaVersion: "trae-v1",
          },
        ],
      },
    });

    const response = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/fetch-task",
      body: { worker_id: "trae-01", repo_dir: repoDir },
    });
    expect(response.status).toBe(200);
    expect(response.json.status).toBe("ok");
    expect(response.json.task.goal).toBe("Test task");
    expect(response.json.task.default_branch).toBe("main");
    expect(response.json.task.worktree_dir).toBe(`${repoDir}/.worktrees/dispatch-1-task-1`);
    expect(response.json.task.assignment_dir).toBe(`${repoDir}/.worktrees/dispatch-1-task-1/.orchestrator/assignments/dispatch-1-task-1`);
    expect(response.json.task.worker_prompt_mode).toBe("auto");
    expect(response.json.task.report_schema_version).toBe("trae-v1");
    expect(response.json.task.constraints).toContain("allowedPaths: docs/**");
    expect(response.json.task.constraints).toContain("must run acceptance: pnpm test");
    expect(fs.existsSync(response.json.task.assignment_dir)).toBe(false);
  });

  it("fetch_task returns the same in_progress task when the worker retries after start", async () => {
    const stateDir = makeTempDir();
    const repoDir = path.join(stateDir, "repo");
    fs.mkdirSync(repoDir, { recursive: true });
    const mod = await import(serverModulePath);

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/heartbeat",
      body: { worker_id: "trae-retry" },
    });

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/dispatches",
      body: {
        repo: "test/repo",
        defaultBranch: "main",
        requestedBy: "test",
        tasks: [
          {
            id: "task-retry",
            title: "Retry task",
            pool: "trae",
            allowedPaths: ["docs/**"],
            acceptance: [],
            dependsOn: [],
            branchName: "ai/trae/task-retry",
          },
        ],
        packages: [
          {
            taskId: "task-retry",
            assignment: {
              taskId: "task-retry",
              workerId: "trae-retry",
              pool: "trae",
              status: "assigned",
              branchName: "ai/trae/task-retry",
              allowedPaths: ["docs/**"],
              repo: "test/repo",
              defaultBranch: "main",
            },
          },
        ],
      },
    });

    const firstFetch = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/fetch-task",
      body: { worker_id: "trae-retry", repo_dir: repoDir },
    });
    const taskId = firstFetch.json.task.task_id;

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/start-task",
      body: { worker_id: "trae-retry", task_id: taskId },
    });

    const retryFetch = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/fetch-task",
      body: { worker_id: "trae-retry", repo_dir: repoDir },
    });

    expect(retryFetch.status).toBe(200);
    expect(retryFetch.json.status).toBe("ok");
    expect(retryFetch.json.task.task_id).toBe(taskId);

    const snapshot = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/api/dashboard/snapshot",
    });
    const worker = snapshot.json.workers.find((item: { id: string }) => item.id === "trae-retry");
    expect(worker.currentTaskId).toBe(taskId);
    const task = snapshot.json.tasks.find((item: { id: string }) => item.id === taskId);
    expect(task.status).toBe("in_progress");
  });

  it("fetch_task returns continuation_mode and continue_from_task_id for redrive tasks", async () => {
    const stateDir = makeTempDir();
    const repoDir = path.join(stateDir, "repo");
    fs.mkdirSync(repoDir, { recursive: true });
    const mod = await import(serverModulePath);

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/heartbeat",
      body: { worker_id: "trae-cont" },
    });

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/dispatches",
      body: {
        repo: "test/repo",
        defaultBranch: "main",
        requestedBy: "test",
        tasks: [
          {
            id: "task-cont",
            title: "Continuation task",
            pool: "trae",
            allowedPaths: ["src/**"],
            acceptance: ["pnpm test"],
            dependsOn: [],
            branchName: "ai/trae/task-cont",
            continuationMode: "continue",
            continueFromTaskId: "dispatch-1:task-1",
          },
        ],
        packages: [
          {
            taskId: "task-cont",
            assignment: {
              taskId: "task-cont",
              workerId: "trae-cont",
              pool: "trae",
              status: "assigned",
              branchName: "ai/trae/task-cont",
              allowedPaths: ["src/**"],
              repo: "test/repo",
              defaultBranch: "main",
              continuationMode: "continue",
              continueFromTaskId: "dispatch-1:task-1",
            },
            workerPrompt: "Continue from previous task",
          },
        ],
      },
    });

    const response = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/fetch-task",
      body: { worker_id: "trae-cont", repo_dir: repoDir },
    });

    expect(response.status).toBe(200);
    expect(response.json.status).toBe("ok");
    expect(response.json.task.continuation_mode).toBe("continue");
    expect(response.json.task.continue_from_task_id).toBe("dispatch-1:task-1");
  });

  it("report_progress writes progress event", async () => {
    const stateDir = makeTempDir();
    const mod = await import(serverModulePath);

    const response = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/report-progress",
      body: { task_id: "task-1", message: "Working on it..." },
    });
    expect(response.status).toBe(200);
    expect(response.json.ok).toBe(true);

    const snapshot = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/api/dashboard/snapshot",
    });
    const progressEvent = snapshot.json.events.find(
      (e: { type: string }) => e.type === "progress_reported",
    );
    expect(progressEvent).toBeDefined();
    expect(progressEvent.payload.message).toBe("Working on it...");
  });

  it("keeps targetWorkerId on dispatch creation and only lets the target trae worker claim it", async () => {
    const stateDir = makeTempDir();
    const repoDir = path.join(stateDir, "repo");
    fs.mkdirSync(repoDir, { recursive: true });
    const mod = await import(serverModulePath);

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/heartbeat",
      body: { worker_id: "trae-local" },
    });

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/heartbeat",
      body: { worker_id: "trae-remote" },
    });

    const dispatchResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/dispatches",
      body: {
        repo: "test/repo",
        defaultBranch: "main",
        requestedBy: "test",
        tasks: [
          {
            id: "task-1",
            title: "Target remote worker",
            pool: "trae",
            allowedPaths: ["docs/**"],
            acceptance: ["pnpm test"],
            dependsOn: [],
            branchName: "ai/trae/task-targeted",
            target_worker_id: "trae-remote",
          },
        ],
        packages: [
          {
            taskId: "task-1",
            assignment: {
              taskId: "task-1",
              workerId: null,
              pool: "trae",
              status: "pending",
              branchName: "ai/trae/task-targeted",
              allowedPaths: ["docs/**"],
              repo: "test/repo",
              defaultBranch: "main",
              target_worker_id: "trae-remote",
            },
            workerPrompt: "Test prompt",
          },
        ],
      },
    });
    expect(dispatchResponse.status).toBe(200);
    expect(dispatchResponse.json.assignments[0]).toMatchObject({
      workerId: "trae-remote",
      status: "assigned",
    });

    const localFetch = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/fetch-task",
      body: { worker_id: "trae-local", repo_dir: repoDir },
    });
    expect(localFetch.status).toBe(200);
    expect(localFetch.json.status).toBe("no_task");

    const remoteFetch = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/fetch-task",
      body: { worker_id: "trae-remote", repo_dir: repoDir },
    });
    expect(remoteFetch.status).toBe(200);
    expect(remoteFetch.json.status).toBe("ok");
    expect(remoteFetch.json.task.branch).toBe("ai/trae/task-targeted");
  });

  it("does not let a non-target trae worker claim a ready targeted task", async () => {
    const stateDir = makeTempDir();
    const repoDir = path.join(stateDir, "repo");
    fs.mkdirSync(repoDir, { recursive: true });
    const mod = await import(serverModulePath);

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/heartbeat",
      body: { worker_id: "trae-local" },
    });

    const dispatchResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/dispatches",
      body: {
        repo: "test/repo",
        defaultBranch: "main",
        requestedBy: "test",
        tasks: [
          {
            id: "task-1",
            title: "Target remote worker later",
            pool: "trae",
            allowedPaths: ["docs/**"],
            acceptance: ["pnpm test"],
            dependsOn: [],
            branchName: "ai/trae/task-targeted-later",
            targetWorkerId: "trae-remote",
          },
        ],
        packages: [
          {
            taskId: "task-1",
            assignment: {
              taskId: "task-1",
              workerId: null,
              pool: "trae",
              status: "pending",
              branchName: "ai/trae/task-targeted-later",
              allowedPaths: ["docs/**"],
              repo: "test/repo",
              defaultBranch: "main",
            },
            workerPrompt: "Test prompt",
          },
        ],
      },
    });
    expect(dispatchResponse.status).toBe(200);
    expect(dispatchResponse.json.assignments[0]).toMatchObject({
      workerId: null,
      status: "pending",
    });

    const localFetch = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/fetch-task",
      body: { worker_id: "trae-local", repo_dir: repoDir },
    });
    expect(localFetch.status).toBe(200);
    expect(localFetch.json.status).toBe("no_task");
  });

  it("normalizes follow-up snake_case fields and defaults sticky-worker target from the source task", async () => {
    const stateDir = makeTempDir();
    const mod = await import(serverModulePath);

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/heartbeat",
      body: { worker_id: "trae-local" },
    });

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/heartbeat",
      body: { worker_id: "trae-remote" },
    });

    const sourceDispatch = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/dispatches",
      body: {
        repo: "test/repo",
        defaultBranch: "main",
        requestedBy: "test",
        tasks: [
          {
            id: "task-source",
            title: "Source task",
            pool: "trae",
            allowedPaths: ["docs/**"],
            acceptance: ["pnpm test"],
            dependsOn: [],
            branchName: "ai/trae/task-source",
            target_worker_id: "trae-remote",
          },
        ],
        packages: [
          {
            taskId: "task-source",
            assignment: {
              taskId: "task-source",
              workerId: null,
              pool: "trae",
              status: "pending",
              branchName: "ai/trae/task-source",
              allowedPaths: ["docs/**"],
              repo: "test/repo",
              defaultBranch: "main",
            },
            workerPrompt: "Source prompt",
          },
        ],
      },
    });

    const followUpDispatch = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/dispatches",
      body: {
        repo: "test/repo",
        defaultBranch: "main",
        requestedBy: "test",
        tasks: [
          {
            id: "task-follow-up",
            title: "Follow-up task",
            pool: "trae",
            allowedPaths: ["docs/**"],
            acceptance: ["pnpm test"],
            dependsOn: [],
            branchName: "ai/trae/task-follow-up",
            follow_up_of_task_id: sourceDispatch.json.taskIds[0],
          },
        ],
        packages: [
          {
            taskId: "task-follow-up",
            assignment: {
              taskId: "task-follow-up",
              workerId: null,
              pool: "trae",
              status: "pending",
              branchName: "ai/trae/task-follow-up",
              allowedPaths: ["docs/**"],
              repo: "test/repo",
              defaultBranch: "main",
            },
            workerPrompt: "Follow-up prompt",
          },
        ],
      },
    });

    expect(followUpDispatch.status).toBe(200);

    const snapshot = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/api/dashboard/snapshot",
    });
    const followUpTask = snapshot.json.tasks.find((item: { id: string }) => item.id === followUpDispatch.json.taskIds[0]);
    expect(followUpTask.followUpOfTaskId).toBe(sourceDispatch.json.taskIds[0]);
    expect(followUpTask.targetWorkerId).toBe("trae-remote");

    const followUpAssignment = snapshot.json.assignments.find((item: { taskId: string }) => item.taskId === followUpDispatch.json.taskIds[0]);
    expect(followUpAssignment.assignment.followUpOfTaskId).toBe(sourceDispatch.json.taskIds[0]);
    expect(followUpAssignment.assignment.targetWorkerId).toBe("trae-remote");
  });

  it("submit_result with review_ready moves task to review", async () => {
    const stateDir = makeTempDir();
    const mod = await import(serverModulePath);

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/heartbeat",
      body: { worker_id: "trae-01" },
    });

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/dispatches",
      body: {
        repo: "test/repo",
        defaultBranch: "main",
        requestedBy: "test",
        tasks: [
          {
            id: "task-2",
            title: "Test task 2",
            pool: "trae",
            allowedPaths: ["docs/**"],
            acceptance: ["pnpm test"],
            dependsOn: [],
            branchName: "ai/trae/task-2",
          },
        ],
        packages: [
          {
            taskId: "task-2",
            assignment: {
              taskId: "task-2",
              workerId: "trae-01",
              pool: "trae",
              status: "assigned",
              branchName: "ai/trae/task-2",
              allowedPaths: ["docs/**"],
              repo: "test/repo",
              defaultBranch: "main",
            },
          },
        ],
      },
    });

    const fetchResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/fetch-task",
      body: { worker_id: "trae-01" },
    });
    const taskId = fetchResponse.json.task.task_id;

    const response = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/submit-result",
      body: {
        task_id: taskId,
        status: "review_ready",
        summary: "Done!",
        test_output: "PASS",
        risks: ["Low risk"],
        files_changed: ["docs/test.md"],
        branch_name: "ai/trae/task-2",
        commit_sha: "abc123def456",
        push_status: "success",
        pr_number: 42,
        pr_url: "https://github.com/test/repo/pull/42",
      },
    });
    expect(response.status).toBe(200);
    expect(response.json.ok).toBe(true);

    const snapshot = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/api/dashboard/snapshot",
    });
    const task = snapshot.json.tasks.find((t: { id: string }) => t.id === taskId);
    expect(task.status).toBe("review");
    const assignment = snapshot.json.assignments.find((item: { taskId: string }) => item.taskId === taskId);
    expect(assignment.status).toBe("review");
    expect(assignment.assignment.status).toBe("review");

    const submitEvent = snapshot.json.events.find(
      (e: { type: string; taskId: string }) => e.type === "status_changed" && e.taskId === taskId,
    );
    expect(submitEvent).toBeDefined();
    expect(submitEvent.payload.to).toBe("review");
    const review = snapshot.json.reviews.find((item: { taskId: string }) => item.taskId === taskId);
    expect(review.latestWorkerResult.output).toBe("Done!");
    expect(review.latestWorkerResult.verification.commands[0].output).toBe("PASS");
    expect(review.reviewMaterial.pullRequest.number).toBe(42);
  });

  it("submit_result with failed moves task to failed", async () => {
    const stateDir = makeTempDir();
    const mod = await import(serverModulePath);

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/heartbeat",
      body: { worker_id: "trae-02" },
    });

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/dispatches",
      body: {
        repo: "test/repo",
        defaultBranch: "main",
        requestedBy: "test",
        tasks: [
          {
            id: "task-3",
            title: "Test task 3",
            pool: "trae",
            allowedPaths: ["docs/**"],
            acceptance: ["pnpm test"],
            dependsOn: [],
            branchName: "ai/trae/task-3",
          },
        ],
        packages: [
          {
            taskId: "task-3",
            assignment: {
              taskId: "task-3",
              workerId: "trae-02",
              pool: "trae",
              status: "assigned",
              branchName: "ai/trae/task-3",
              allowedPaths: ["docs/**"],
              repo: "test/repo",
              defaultBranch: "main",
            },
          },
        ],
      },
    });

    const fetchResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/fetch-task",
      body: { worker_id: "trae-02" },
    });
    const taskId = fetchResponse.json.task.task_id;

    const response = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/submit-result",
      body: {
        task_id: taskId,
        status: "failed",
        summary: "Something went wrong",
        branch_name: "ai/trae/task-3",
        commit_sha: "def789ghi012",
        push_status: "failed",
        push_error: "remote: Permission denied",
      },
    });
    expect(response.status).toBe(200);
    expect(response.json.ok).toBe(true);

    const snapshot = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/api/dashboard/snapshot",
    });
    const task = snapshot.json.tasks.find((t: { id: string }) => t.id === taskId);
    expect(task.status).toBe("failed");
    const assignment = snapshot.json.assignments.find((item: { taskId: string }) => item.taskId === taskId);
    expect(assignment.status).toBe("failed");
    expect(assignment.assignment.status).toBe("failed");

    const failedEvent = snapshot.json.events.find(
      (e: { type: string; taskId: string }) => e.type === "status_changed" && e.taskId === taskId,
    );
    expect(failedEvent).toBeDefined();
    expect(failedEvent.payload.to).toBe("failed");
    const review = snapshot.json.reviews.find((item: { taskId: string }) => item.taskId === taskId);
    expect(review.latestWorkerResult.output).toBe("Something went wrong");
  });

  it("heartbeat updates worker lastHeartbeatAt", async () => {
    const stateDir = makeTempDir();
    const mod = await import(serverModulePath);

    const response = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/heartbeat",
      body: { worker_id: "trae-03" },
    });
    expect(response.status).toBe(200);
    expect(response.json.ok).toBe(true);

    const snapshot = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/api/dashboard/snapshot",
    });
    const worker = snapshot.json.workers.find((w: { id: string }) => w.id === "trae-03");
    expect(worker).toBeDefined();
    expect(worker.pool).toBe("trae");
    expect(worker.lastHeartbeatAt).toBeDefined();
  });

  it("rejects POST request bodies larger than 16KB", async () => {
    const mod = await import(serverModulePath);

    await expect(mod.readJsonBody(Readable.from([
      Buffer.alloc(16 * 1024 + 1),
    ]))).rejects.toMatchObject({
      code: "payload_too_large",
    });
  });

  it("dashboard html redirects to the standalone console app", async () => {
    const stateDir = makeTempDir();
    const mod = await import(serverModulePath);

    const dashboardResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/dashboard",
    });

    expect(dashboardResponse.status).toBe(200);
    expect(dashboardResponse.text).not.toContain(".innerHTML");
    expect(dashboardResponse.text).toContain("ForgeFlow Console Redirect");
    expect(dashboardResponse.text).toContain("window.location.href = 'http://localhost:8788';");
  });

  it("disables and enables workers via API", async () => {
    const stateDir = makeTempDir();
    const mod = await import(serverModulePath);

    const registerResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/register",
      body: {
        workerId: "test-worker-1",
        pool: "test",
        hostname: "test-host",
        labels: ["test"],
        repoDir: "/test",
      },
    });
    expect(registerResponse.status).toBe(200);

    const disableResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/test-worker-1/disable",
      body: { at: "2026-04-03T00:00:00.000Z" },
    });
    expect(disableResponse.status).toBe(200);
    expect(disableResponse.json.status).toBe("disabled");
    expect(disableResponse.json.workers.find((w: { id: string }) => w.id === "test-worker-1").status).toBe("disabled");

    const enableResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/test-worker-1/enable",
      body: { at: "2026-04-03T00:01:00.000Z" },
    });
    expect(enableResponse.status).toBe(200);
    expect(enableResponse.json.status).toBe("enabled");
    expect(enableResponse.json.workers.find((w: { id: string }) => w.id === "test-worker-1").status).toBe("idle");
  });

  it("keeps disabled workers visible as disabled in dashboard snapshots", async () => {
    const stateDir = makeTempDir();
    const mod = await import(serverModulePath);

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/register",
      body: {
        workerId: "test-worker-disabled-offline",
        pool: "trae",
        hostname: "test-host",
        labels: ["test"],
        repoDir: "/test",
        at: "2026-04-03T00:00:00.000Z",
      },
    });

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/test-worker-disabled-offline/disable",
      body: { at: "2026-04-03T00:00:05.000Z" },
    });

    const snapshotResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/api/dashboard/snapshot",
    });

    expect(snapshotResponse.status).toBe(200);
    const worker = snapshotResponse.json.workers.find((w: { id: string }) => w.id === "test-worker-disabled-offline");
    expect(worker).toMatchObject({
      status: "disabled",
      disabledAt: "2026-04-03T00:00:05.000Z",
    });
  });

  it("dashboard includes a fallback link to the standalone console app", async () => {
    const stateDir = makeTempDir();
    const mod = await import(serverModulePath);

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/register",
      body: {
        workerId: "test-worker-2",
        pool: "test",
        hostname: "test-host",
        labels: ["test"],
        repoDir: "/test",
      },
    });

    const dashboardResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/dashboard",
    });

    expect(dashboardResponse.status).toBe(200);
    expect(dashboardResponse.text).toContain('Redirecting to <a href="http://localhost:8788">ForgeFlow Console</a>...');
  });

  describe("auth middleware", () => {
    const originalEnv = process.env.DISPATCHER_API_TOKEN;
    const originalAuthMode = process.env.DISPATCHER_AUTH_MODE;

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.DISPATCHER_API_TOKEN;
      } else {
        process.env.DISPATCHER_API_TOKEN = originalEnv;
      }
      if (originalAuthMode === undefined) {
        delete process.env.DISPATCHER_AUTH_MODE;
      } else {
        process.env.DISPATCHER_AUTH_MODE = originalAuthMode;
      }
    });

    it("returns 500 when DISPATCHER_API_TOKEN is not set (default token mode)", async () => {
      delete process.env.DISPATCHER_API_TOKEN;
      delete process.env.DISPATCHER_AUTH_MODE;
      const stateDir = makeTempDir();
      const mod = await import(serverModulePath);

      const response = await mod.handleDispatcherHttpRequest({
        stateDir,
        method: "GET",
        pathname: "/api/workers",
      });
      expect(response.status).toBe(500);
      expect(response.json.error).toBe("DISPATCHER_API_TOKEN is required when auth mode is 'token'");
    });

    it("returns 401 when token is required but missing (default token mode)", async () => {
      process.env.DISPATCHER_API_TOKEN = "test-secret-token";
      delete process.env.DISPATCHER_AUTH_MODE;
      const stateDir = makeTempDir();
      const mod = await import(serverModulePath);

      const response = await mod.handleDispatcherHttpRequest({
        stateDir,
        method: "GET",
        pathname: "/api/workers",
      });
      expect(response.status).toBe(401);
      expect(response.json.error).toBe("unauthorized");
    });

    it("returns 401 when token is required but incorrect (default token mode)", async () => {
      process.env.DISPATCHER_API_TOKEN = "test-secret-token";
      delete process.env.DISPATCHER_AUTH_MODE;
      const stateDir = makeTempDir();
      const mod = await import(serverModulePath);

      const response = await mod.handleDispatcherHttpRequest({
        stateDir,
        method: "GET",
        pathname: "/api/workers",
        authHeader: "Bearer wrong-token",
      });
      expect(response.status).toBe(401);
      expect(response.json.error).toBe("unauthorized");
    });

    it("allows access with correct token (default token mode)", async () => {
      process.env.DISPATCHER_API_TOKEN = "test-secret-token";
      delete process.env.DISPATCHER_AUTH_MODE;
      const stateDir = makeTempDir();
      const mod = await import(serverModulePath);

      const response = await mod.handleDispatcherHttpRequest({
        stateDir,
        method: "GET",
        pathname: "/api/workers",
        authHeader: "Bearer test-secret-token",
      });
      expect(response.status).toBe(200);
    });

    it("allows /health without authentication (default token mode)", async () => {
      process.env.DISPATCHER_API_TOKEN = "test-secret-token";
      delete process.env.DISPATCHER_AUTH_MODE;
      const stateDir = makeTempDir();
      const mod = await import(serverModulePath);

      const response = await mod.handleDispatcherHttpRequest({
        stateDir,
        method: "GET",
        pathname: "/health",
      });
      expect(response.status).toBe(200);
      expect(response.json.status).toBe("ok");
    });

    it("rejects malformed authorization header (default token mode)", async () => {
      process.env.DISPATCHER_API_TOKEN = "test-secret-token";
      delete process.env.DISPATCHER_AUTH_MODE;
      const stateDir = makeTempDir();
      const mod = await import(serverModulePath);

      const response = await mod.handleDispatcherHttpRequest({
        stateDir,
        method: "GET",
        pathname: "/api/workers",
        authHeader: "InvalidFormat token",
      });
      expect(response.status).toBe(401);
      expect(response.json.error).toBe("unauthorized");
    });

    it("allows all requests in open mode", async () => {
      process.env.DISPATCHER_AUTH_MODE = "open";
      process.env.DISPATCHER_API_TOKEN = "test-secret-token";
      const stateDir = makeTempDir();
      const mod = await import(serverModulePath);

      const response = await mod.handleDispatcherHttpRequest({
        stateDir,
        method: "GET",
        pathname: "/api/workers",
      });
      expect(response.status).toBe(200);
    });

    it("allows /health in open mode without token", async () => {
      process.env.DISPATCHER_AUTH_MODE = "open";
      delete process.env.DISPATCHER_API_TOKEN;
      const stateDir = makeTempDir();
      const mod = await import(serverModulePath);

      const response = await mod.handleDispatcherHttpRequest({
        stateDir,
        method: "GET",
        pathname: "/health",
      });
      expect(response.status).toBe(200);
      expect(response.json.status).toBe("ok");
    });

    it("returns 401 when token mode is enabled but token is missing", async () => {
      process.env.DISPATCHER_AUTH_MODE = "token";
      delete process.env.DISPATCHER_API_TOKEN;
      const stateDir = makeTempDir();
      const mod = await import(serverModulePath);

      const response = await mod.handleDispatcherHttpRequest({
        stateDir,
        method: "GET",
        pathname: "/api/workers",
      });
      expect(response.status).toBe(500);
      expect(response.json.error).toBe("DISPATCHER_API_TOKEN is required when auth mode is 'token'");
    });

    it("returns 401 when token mode is enabled but token is incorrect", async () => {
      process.env.DISPATCHER_AUTH_MODE = "token";
      process.env.DISPATCHER_API_TOKEN = "test-secret-token";
      const stateDir = makeTempDir();
      const mod = await import(serverModulePath);

      const response = await mod.handleDispatcherHttpRequest({
        stateDir,
        method: "GET",
        pathname: "/api/workers",
        authHeader: "Bearer wrong-token",
      });
      expect(response.status).toBe(401);
      expect(response.json.error).toBe("unauthorized");
    });

    it("allows access with correct token in token mode", async () => {
      process.env.DISPATCHER_AUTH_MODE = "token";
      process.env.DISPATCHER_API_TOKEN = "test-secret-token";
      const stateDir = makeTempDir();
      const mod = await import(serverModulePath);

      const response = await mod.handleDispatcherHttpRequest({
        stateDir,
        method: "GET",
        pathname: "/api/workers",
        authHeader: "Bearer test-secret-token",
      });
      expect(response.status).toBe(200);
    });

    it("allows /health without authentication in token mode", async () => {
      process.env.DISPATCHER_AUTH_MODE = "token";
      process.env.DISPATCHER_API_TOKEN = "test-secret-token";
      const stateDir = makeTempDir();
      const mod = await import(serverModulePath);

      const response = await mod.handleDispatcherHttpRequest({
        stateDir,
        method: "GET",
        pathname: "/health",
      });
      expect(response.status).toBe(200);
      expect(response.json.status).toBe("ok");
    });

    it("allows loopback requests in legacy mode without token", async () => {
      process.env.DISPATCHER_AUTH_MODE = "legacy";
      delete process.env.DISPATCHER_API_TOKEN;
      const stateDir = makeTempDir();
      const mod = await import(serverModulePath);

      const response = await mod.handleDispatcherHttpRequest({
        stateDir,
        method: "GET",
        pathname: "/api/workers",
        clientAddress: "127.0.0.1",
      });
      expect(response.status).toBe(200);
    });

    it("allows IPv6 loopback requests in legacy mode without token", async () => {
      process.env.DISPATCHER_AUTH_MODE = "legacy";
      delete process.env.DISPATCHER_API_TOKEN;
      const stateDir = makeTempDir();
      const mod = await import(serverModulePath);

      const response = await mod.handleDispatcherHttpRequest({
        stateDir,
        method: "GET",
        pathname: "/api/workers",
        clientAddress: "::1",
      });
      expect(response.status).toBe(200);
    });

    it("allows IPv4-mapped IPv6 loopback requests in legacy mode without token", async () => {
      process.env.DISPATCHER_AUTH_MODE = "legacy";
      delete process.env.DISPATCHER_API_TOKEN;
      const stateDir = makeTempDir();
      const mod = await import(serverModulePath);

      const response = await mod.handleDispatcherHttpRequest({
        stateDir,
        method: "GET",
        pathname: "/api/workers",
        clientAddress: "::ffff:127.0.0.1",
      });
      expect(response.status).toBe(200);
    });

    it("rejects non-loopback requests in legacy mode without token", async () => {
      process.env.DISPATCHER_AUTH_MODE = "legacy";
      delete process.env.DISPATCHER_API_TOKEN;
      const stateDir = makeTempDir();
      const mod = await import(serverModulePath);

      const response = await mod.handleDispatcherHttpRequest({
        stateDir,
        method: "GET",
        pathname: "/api/workers",
        clientAddress: "192.168.1.100",
      });
      expect(response.status).toBe(401);
      expect(response.json.error).toBe("unauthorized");
    });

    it("allows /health in legacy mode without token for non-loopback", async () => {
      process.env.DISPATCHER_AUTH_MODE = "legacy";
      delete process.env.DISPATCHER_API_TOKEN;
      const stateDir = makeTempDir();
      const mod = await import(serverModulePath);

      const response = await mod.handleDispatcherHttpRequest({
        stateDir,
        method: "GET",
        pathname: "/health",
        clientAddress: "192.168.1.100",
      });
      expect(response.status).toBe(200);
      expect(response.json.status).toBe("ok");
    });

    it("requires token in legacy mode when token is set", async () => {
      process.env.DISPATCHER_AUTH_MODE = "legacy";
      process.env.DISPATCHER_API_TOKEN = "test-secret-token";
      const stateDir = makeTempDir();
      const mod = await import(serverModulePath);

      const response = await mod.handleDispatcherHttpRequest({
        stateDir,
        method: "GET",
        pathname: "/api/workers",
        clientAddress: "127.0.0.1",
      });
      expect(response.status).toBe(401);
      expect(response.json.error).toBe("unauthorized");
    });

    it("allows access with correct token in legacy mode", async () => {
      process.env.DISPATCHER_AUTH_MODE = "legacy";
      process.env.DISPATCHER_API_TOKEN = "test-secret-token";
      const stateDir = makeTempDir();
      const mod = await import(serverModulePath);

      const response = await mod.handleDispatcherHttpRequest({
        stateDir,
        method: "GET",
        pathname: "/api/workers",
        authHeader: "Bearer test-secret-token",
        clientAddress: "192.168.1.100",
      });
      expect(response.status).toBe(200);
    });
  });
});
