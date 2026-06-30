import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);
const serverModulePath = path.join(repoRoot, "scripts/lib/dispatcher-server.js");
const tempRoots: string[] = [];

const originalEnv = process.env.DISPATCHER_API_TOKEN;
const originalAuthMode = process.env.DISPATCHER_AUTH_MODE;
const originalConfigPath = process.env.FORGEFLOW_DISPATCHER_CONFIG_PATH;
const originalStateLockTimeout = process.env.DISPATCHER_STATE_LOCK_TIMEOUT_MS;
const originalStateLockRetry = process.env.DISPATCHER_STATE_LOCK_RETRY_MS;
const originalStateLockStale = process.env.DISPATCHER_STATE_LOCK_STALE_MS;
const originalStructuredReads = process.env.DISPATCHER_STRUCTURED_READS;
const originalReadOnlyMode = process.env.DISPATCHER_READ_ONLY_MODE;

function makeTempDir() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-dispatcher-server-"));
  tempRoots.push(tempDir);
  return tempDir;
}

beforeAll(() => {
  process.env.DISPATCHER_AUTH_MODE = "open";
});

beforeEach(() => {
  const configRoot = makeTempDir();
  process.env.FORGEFLOW_DISPATCHER_CONFIG_PATH = path.join(configRoot, ".forgeflow-dispatcher.json");
});

afterEach(() => {
  for (const tempDir of tempRoots.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  if (originalConfigPath === undefined) {
    delete process.env.FORGEFLOW_DISPATCHER_CONFIG_PATH;
  } else {
    process.env.FORGEFLOW_DISPATCHER_CONFIG_PATH = originalConfigPath;
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
  if (originalStructuredReads === undefined) {
    delete process.env.DISPATCHER_STRUCTURED_READS;
  } else {
    process.env.DISPATCHER_STRUCTURED_READS = originalStructuredReads;
  }
  if (originalReadOnlyMode === undefined) {
    delete process.env.DISPATCHER_READ_ONLY_MODE;
  } else {
    process.env.DISPATCHER_READ_ONLY_MODE = originalReadOnlyMode;
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

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/codex-mac-mini/claim-task",
      body: {},
    });
    const stateMod = await import(path.join(repoRoot, "scripts/lib/dispatcher-state.js"));
    const attempt = stateMod.loadRuntimeState(stateDir).taskAttempts[0];
    const startResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/codex-mac-mini/start-task",
      body: {
        taskId: dispatchBody.taskIds[0],
        attemptId: attempt.attemptId,
        leaseToken: attempt.leaseToken,
        protocolVersion: attempt.protocolVersion,
        traceId: attempt.traceId,
        idempotencyKey: attempt.idempotencyKey,
      },
    });
    expect(startResponse.status).toBe(200);

    const resultResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/codex-mac-mini/result",
      body: {
        attemptId: attempt.attemptId,
        leaseToken: attempt.leaseToken,
        protocolVersion: attempt.protocolVersion,
        traceId: attempt.traceId,
        idempotencyKey: attempt.idempotencyKey,
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
      submitResultRetryCount: 0,
      retryRatePct: 0,
      deliveryFailedCount: 0,
      cleanupFailureCount: 0,
      sessionInterruptionCount: 0,
      stateLockTimeoutCount: 0,
      shadowWriteFailureCount: 0,
      branchProtectionHitCount: 0,
      repoConcurrencySaturation: {
        "/repo": {
          activeWorkers: 1,
          busyWorkers: 0,
          saturationPct: 0,
        },
      },
      failureCodes: {},
      reviewReasonCodes: {},
      workers: {
        total: 1,
      },
      tasks: {
        total: 2,
        ready: 1,
      },
    });
    expect(response.json).toHaveProperty("leaseConflictCount");
    expect(response.json).toHaveProperty("shadowWriteFailureCount");
    expect(response.json).toHaveProperty("activeLeases");
  });

  it("serves structured query endpoints and projection health", async () => {
    const stateDir = makeTempDir();
    process.env.DISPATCHER_STRUCTURED_READS = "1";
    const mod = await import(serverModulePath);

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/dispatches",
      body: {
        repo: "test/query",
        defaultBranch: "main",
        requestedBy: "test",
        tasks: [
          {
            id: "task-query",
            title: "Query task",
            pool: "codex",
            allowedPaths: ["docs/**"],
            acceptance: [],
            dependsOn: [],
            branchName: "ai/codex/task-query",
          },
        ],
        packages: [
          {
            taskId: "task-query",
            assignment: {
              taskId: "task-query",
              workerId: null,
              pool: "codex",
              status: "pending",
              branchName: "ai/codex/task-query",
              allowedPaths: ["docs/**"],
              repo: "test/query",
              defaultBranch: "main",
            },
          },
        ],
      },
    });

    const tasksResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/api/query/tasks",
    });
    expect(tasksResponse.status).toBe(200);
    expect(tasksResponse.json).toHaveLength(1);

    const snapshotResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/api/query/dashboard-snapshot",
    });
    expect(snapshotResponse.status).toBe(200);
    expect(snapshotResponse.json.tasks).toHaveLength(1);

    const projectionHealth = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/api/query/projection-health",
    });
    expect(projectionHealth.status).toBe(200);
    expect(projectionHealth.json.matches).toBe(true);
  });

  it("exposes stage-three slo and dr status endpoints", async () => {
    const stateDir = makeTempDir();
    const backupDir = path.join(stateDir, "backups");
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, "2026-04-08-manifest.json"), JSON.stringify({ ok: true }));
    const mod = await import(serverModulePath);

    const sloResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/api/slo",
    });
    expect(sloResponse.status).toBe(200);
    expect(sloResponse.json).toHaveProperty("targets");
    expect(sloResponse.json).toHaveProperty("burnRate");

    fs.writeFileSync(path.join(stateDir, "runtime-state-shadow-status.json"), JSON.stringify({
      status: "failed",
      mode: "shadow-write",
      queueMode: "disabled",
      configured: true,
      lastAttemptAt: "2999-05-15T00:00:00.000Z",
      lastSuccessAt: null,
      lastFailureAt: "2999-05-15T00:00:01.000Z",
      lastError: "persisted shadow failure",
    }));

    const drResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/api/dr/status",
    });
    expect(drResponse.status).toBe(200);
    expect(drResponse.json.backups).toHaveLength(1);
    expect(drResponse.json).toHaveProperty("projectionHealth");
    expect(drResponse.json).toHaveProperty("shadowWrite");
    expect(drResponse.json.shadowWrite.lastError).toBe("persisted shadow failure");
  });

  it("rejects mutation routes when read-only mode is enabled", async () => {
    const stateDir = makeTempDir();
    process.env.DISPATCHER_READ_ONLY_MODE = "1";
    const mod = await import(serverModulePath);

    const mutationRoutes = [
      "/api/dispatches",
      "/api/workers/codex-readonly/claim-task",
      "/api/workers/codex-readonly/start-task",
      "/api/workers/codex-readonly/result",
      "/api/reviews/task-readonly/decision",
      "/api/future-write",
    ];

    for (const pathname of mutationRoutes) {
      const mutationResponse = await mod.handleDispatcherHttpRequest({
        stateDir,
        method: "POST",
        pathname,
        body: {
          repo: "test/readonly",
          defaultBranch: "main",
          requestedBy: "test",
          tasks: [],
          packages: [],
        },
      });
      expect(mutationResponse.status).toBe(503);
      expect(mutationResponse.json.code).toBe("read_only_mode");
    }

    const healthResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/health",
    });
    expect(healthResponse.status).toBe(200);
    expect(healthResponse.json.readOnly).toBe(true);
  });

  it("does not persist reconcile changes from read-only GET routes", async () => {
    const stateDir = makeTempDir();
    const mod = await import(serverModulePath);
    const stateMod = await import(path.join(repoRoot, "scripts/lib/dispatcher-state.js"));

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/register",
      body: {
        workerId: "stale-worker",
        pool: "codex",
        hostname: "stale-host",
        labels: ["stale"],
        repoDir: "/repo",
        at: "2026-01-01T00:00:00.000Z",
      },
    });

    process.env.DISPATCHER_READ_ONLY_MODE = "1";
    const workersResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/api/workers",
    });

    expect(workersResponse.status).toBe(200);
    expect(workersResponse.json[0].status).toBe("offline");

    const persistedState = stateMod.loadRuntimeState(stateDir);
    expect(persistedState.workers[0].status).toBe("idle");
  });

  it("rejects malformed worker register bodies", async () => {
    const stateDir = makeTempDir();
    const mod = await import(serverModulePath);

    const response = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/register",
      body: {
        pool: "codex",
        hostname: "host-without-worker-id",
      },
    });

    expect(response.status).toBe(400);
    expect(response.json.error).toBe("worker register workerId is required");
  });

  it("accepts worker events and rolls them into dispatcher metrics", async () => {
    const stateDir = makeTempDir();
    const mod = await import(serverModulePath);

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/register",
      body: {
        workerId: "codex-events",
        pool: "codex",
        hostname: "events-host",
        labels: [],
        repoDir: "/repo",
      },
    });

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/codex-events/events",
      body: {
        type: "submit_result_retry_failed",
        taskId: "dispatch-1:task-1",
        payload: { attempt: 1 },
      },
    });

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/codex-events/events",
      body: {
        type: "delivery_failed",
        taskId: "dispatch-1:task-1",
        payload: { reason: "push failed" },
      },
    });

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/codex-events/events",
      body: {
        type: "worktree_cleanup_failed",
        taskId: "dispatch-1:task-1",
      },
    });

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/codex-events/events",
      body: {
        type: "session_interrupted",
        payload: { sessionId: "session-1" },
      },
    });

    const response = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/api/metrics",
    });

    expect(response.status).toBe(200);
    expect(response.json).toMatchObject({
      submitResultRetryCount: 1,
      deliveryFailedCount: 1,
      cleanupFailureCount: 1,
      sessionInterruptionCount: 1,
      retryRatePct: 0,
    });
  });

  it("accepts register phase events before the worker record exists", async () => {
    const stateDir = makeTempDir();
    const mod = await import(serverModulePath);

    const eventResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/trae-pre-register/events",
      body: {
        type: "register_start",
        payload: { repoDir: "/repo" },
      },
    });

    expect(eventResponse.status).toBe(200);

    const snapshotResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/api/dashboard/snapshot",
    });

    expect(snapshotResponse.json.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "register_start",
        payload: expect.objectContaining({
          workerId: "trae-pre-register",
        }),
      }),
    ]));
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

    fs.rmSync(lockPath, { force: true });
    const metricsResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/api/metrics",
    });
    expect(metricsResponse.status).toBe(200);
    expect(metricsResponse.json.stateLockTimeoutCount).toBeGreaterThanOrEqual(1);
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

  it("rejects worker HTTP writes with stale attempt lease data", async () => {
    const stateDir = makeTempDir();
    const mod = await import(serverModulePath);
    const stateMod = await import(path.join(repoRoot, "scripts/lib/dispatcher-state.js"));

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/register",
      body: {
        workerId: "codex-lease-http",
        pool: "codex",
        hostname: "lease-http-host",
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
            id: "task-http-lease",
            title: "HTTP lease",
            pool: "codex",
            dependsOn: [],
            branchName: "ai/codex/task-http-lease",
            verification: { mode: "run" },
          },
        ],
        packages: [
          {
            taskId: "task-http-lease",
            assignment: {
              taskId: "task-http-lease",
              workerId: null,
              pool: "codex",
              status: "pending",
              branchName: "ai/codex/task-http-lease",
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
      pathname: "/api/workers/codex-lease-http/claim-task",
      body: {},
    });
    const attempt = stateMod.loadRuntimeState(stateDir).taskAttempts[0];

    const startResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/codex-lease-http/start-task",
      body: {
        taskId,
        attemptId: attempt.attemptId,
        protocolVersion: attempt.protocolVersion,
        traceId: attempt.traceId,
        idempotencyKey: attempt.idempotencyKey,
        leaseToken: "stale-token",
      },
    });
    expect(startResponse.status).toBe(409);
    expect(startResponse.json.error).toBe(`lease token mismatch: ${taskId}`);

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/codex-lease-http/start-task",
      body: {
        taskId,
        attemptId: attempt.attemptId,
        leaseToken: attempt.leaseToken,
        protocolVersion: attempt.protocolVersion,
        traceId: attempt.traceId,
        idempotencyKey: attempt.idempotencyKey,
      },
    });

    const resultResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/codex-lease-http/result",
      body: {
        protocolVersion: attempt.protocolVersion,
        traceId: attempt.traceId,
        idempotencyKey: attempt.idempotencyKey,
        attemptId: "stale-attempt",
        leaseToken: attempt.leaseToken,
        result: {
          taskId,
          workerId: "codex-lease-http",
          provider: "codex",
          pool: "codex",
          branchName: "ai/codex/task-http-lease",
          repo: "test/repo",
          defaultBranch: "main",
          mode: "run",
          output: "done",
          generatedAt: "2026-05-12T12:00:00.000Z",
          verification: {
            allPassed: true,
            commands: [],
          },
        },
      },
    });
    expect(resultResponse.status).toBe(409);
    expect(resultResponse.json.error).toBe("attempt id mismatch: stale-attempt");
  });

  it("rejects generic worker HTTP v1 envelope mismatches", async () => {
    const stateDir = makeTempDir();
    const mod = await import(serverModulePath);
    const stateMod = await import(path.join(repoRoot, "scripts/lib/dispatcher-state.js"));

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/register",
      body: {
        workerId: "codex-v1-envelope-http",
        pool: "codex",
        hostname: "v1-envelope-host",
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
            id: "task-http-v1-envelope",
            title: "HTTP v1 envelope",
            pool: "codex",
            dependsOn: [],
            branchName: "ai/codex/task-http-v1-envelope",
            verification: { mode: "run" },
          },
        ],
        packages: [
          {
            taskId: "task-http-v1-envelope",
            assignment: {
              taskId: "task-http-v1-envelope",
              workerId: null,
              pool: "codex",
              status: "pending",
              branchName: "ai/codex/task-http-v1-envelope",
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
      pathname: "/api/workers/codex-v1-envelope-http/claim-task",
      body: {},
    });
    const attempt = stateMod.loadRuntimeState(stateDir).taskAttempts[0];

    const staleStart = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/codex-v1-envelope-http/start-task",
      body: {
        taskId,
        attemptId: attempt.attemptId,
        leaseToken: attempt.leaseToken,
        protocolVersion: attempt.protocolVersion,
        traceId: "stale-trace-id",
        idempotencyKey: attempt.idempotencyKey,
      },
    });
    expect(staleStart.status).toBe(409);
    expect(staleStart.json.error).toBe(`trace id mismatch: ${taskId}`);

    const startResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/codex-v1-envelope-http/start-task",
      body: {
        taskId,
        attemptId: attempt.attemptId,
        leaseToken: attempt.leaseToken,
        protocolVersion: attempt.protocolVersion,
        traceId: attempt.traceId,
        idempotencyKey: attempt.idempotencyKey,
      },
    });
    expect(startResponse.status).toBe(200);

    const staleResult = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/codex-v1-envelope-http/result",
      body: {
        attemptId: attempt.attemptId,
        leaseToken: attempt.leaseToken,
        protocolVersion: attempt.protocolVersion,
        traceId: attempt.traceId,
        idempotencyKey: "stale-idempotency-key",
        result: {
          taskId,
          workerId: "codex-v1-envelope-http",
          provider: "codex",
          pool: "codex",
          branchName: "ai/codex/task-http-v1-envelope",
          repo: "test/repo",
          defaultBranch: "main",
          mode: "run",
          output: "done",
          generatedAt: "2026-05-12T12:00:00.000Z",
          verification: {
            allPassed: true,
            commands: [],
          },
        },
      },
    });
    expect(staleResult.status).toBe(409);
    expect(staleResult.json.error).toBe(`idempotency key mismatch: ${taskId}`);
  });

  it("persists worker result artifact content and serves stored files", async () => {
    const stateDir = makeTempDir();
    const mod = await import(serverModulePath);
    const stateMod = await import(path.join(repoRoot, "scripts/lib/dispatcher-state.js"));

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/register",
      body: {
        workerId: "codex-artifact-http",
        pool: "codex",
        hostname: "artifact-host",
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
            id: "task-http-artifact",
            title: "HTTP artifact",
            pool: "codex",
            dependsOn: [],
            branchName: "ai/codex/task-http-artifact",
            verification: { mode: "run" },
          },
        ],
        packages: [
          {
            taskId: "task-http-artifact",
            assignment: {
              taskId: "task-http-artifact",
              workerId: null,
              pool: "codex",
              status: "pending",
              branchName: "ai/codex/task-http-artifact",
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
      pathname: "/api/workers/codex-artifact-http/claim-task",
      body: {},
    });
    const attempt = stateMod.loadRuntimeState(stateDir).taskAttempts[0];
    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/codex-artifact-http/start-task",
      body: {
        taskId,
        attemptId: attempt.attemptId,
        leaseToken: attempt.leaseToken,
        protocolVersion: attempt.protocolVersion,
        traceId: attempt.traceId,
        idempotencyKey: attempt.idempotencyKey,
      },
    });

    const resultResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/codex-artifact-http/result",
      body: {
        attemptId: attempt.attemptId,
        leaseToken: attempt.leaseToken,
        protocolVersion: attempt.protocolVersion,
        traceId: attempt.traceId,
        idempotencyKey: attempt.idempotencyKey,
        result: {
          taskId,
          workerId: "codex-artifact-http",
          provider: "codex",
          pool: "codex",
          branchName: "ai/codex/task-http-artifact",
          repo: "test/repo",
          defaultBranch: "main",
          mode: "run",
          output: "done",
          generatedAt: "2026-06-12T09:00:00.000Z",
          verification: {
            allPassed: true,
            commands: [],
          },
        },
        artifactBundle: {
          bundleId: "bundle-http-artifact",
          taskId,
          attemptId: attempt.attemptId,
          schemaVersion: "artifact-bundle/v1",
          summary: "artifact ready",
          changedFiles: [],
          refs: {
            structuredReport: `artifact://${attempt.attemptId}/result.json`,
          },
          retainedContent: {
            diff: "diff --git a/docs/test.md b/docs/test.md",
            logs: "worker log",
            testResults: "all passed",
          },
          riskNotes: [],
          nextActions: [],
          createdAt: "2026-06-12T09:00:00.000Z",
        },
      },
    });
    expect(resultResponse.status).toBe(200);

    const artifactResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/api/artifacts/bundle-http-artifact",
    });
    expect(artifactResponse.status).toBe(200);
    expect(artifactResponse.json.refs.diff).toBe("artifact://bundle-http-artifact/diff.patch");

    const diffResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/api/artifacts/bundle-http-artifact/files/diff.patch",
    });
    expect(diffResponse.status).toBe(200);
    expect(diffResponse.json).toEqual({
      bundleId: "bundle-http-artifact",
      fileName: "diff.patch",
      content: "diff --git a/docs/test.md b/docs/test.md",
    });

    const traversalResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/api/artifacts/bundle-http-artifact/files/..%2Fruntime-state.json",
    });
    expect(traversalResponse.status).toBe(400);
    expect(traversalResponse.json.error).toBe("invalid_artifact_file");
  });

  it("rejects late HTTP results from expired attempts after retry redrive", async () => {
    const stateDir = makeTempDir();
    const mod = await import(serverModulePath);
    const stateMod = await import(path.join(repoRoot, "scripts/lib/dispatcher-state.js"));

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/register",
      body: {
        workerId: "codex-stale-result-http",
        pool: "codex",
        hostname: "stale-result-host",
        labels: [],
        repoDir: "/repo",
        at: "2026-05-12T13:00:00.000Z",
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
            id: "task-stale-result-http",
            title: "HTTP stale result",
            pool: "codex",
            dependsOn: [],
            branchName: "ai/codex/task-stale-result-http",
            verification: { mode: "run" },
          },
        ],
        packages: [
          {
            taskId: "task-stale-result-http",
            assignment: {
              taskId: "task-stale-result-http",
              workerId: null,
              pool: "codex",
              status: "pending",
              branchName: "ai/codex/task-stale-result-http",
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
      pathname: "/api/workers/codex-stale-result-http/claim-task",
      body: { at: "2026-05-12T13:00:20.000Z" },
    });
    const claimedAttempt = stateMod.loadRuntimeState(stateDir).taskAttempts[0];
    const startResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/codex-stale-result-http/start-task",
      body: {
        taskId,
        attemptId: claimedAttempt.attemptId,
        leaseToken: claimedAttempt.leaseToken,
        protocolVersion: claimedAttempt.protocolVersion,
        traceId: claimedAttempt.traceId,
        idempotencyKey: claimedAttempt.idempotencyKey,
        at: "2026-05-12T13:00:30.000Z",
      },
    });
    expect(startResponse.status).toBe(200);

    const runningState = stateMod.loadRuntimeState(stateDir);
    const staleAttempt = runningState.taskAttempts[0];
    stateMod.saveRuntimeState(stateDir, stateMod.reconcileRuntimeState(runningState, {
      now: "2026-05-12T13:11:00.000Z",
      heartbeatTimeoutMs: 60_000,
    }));

    const resultResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/codex-stale-result-http/result",
      body: {
        attemptId: staleAttempt.attemptId,
        leaseToken: staleAttempt.leaseToken,
        protocolVersion: staleAttempt.protocolVersion,
        traceId: staleAttempt.traceId,
        idempotencyKey: staleAttempt.idempotencyKey,
        result: {
          taskId,
          workerId: "codex-stale-result-http",
          provider: "codex",
          pool: "codex",
          branchName: "ai/codex/task-stale-result-http",
          repo: "test/repo",
          defaultBranch: "main",
          mode: "run",
          output: "late stale result",
          generatedAt: "2026-05-12T13:11:30.000Z",
          verification: {
            allPassed: true,
            commands: [],
          },
        },
      },
    });
    expect(resultResponse.status).toBe(409);
    expect(resultResponse.json.error).toMatch(/stale attempt result rejected/i);
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

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/codex-canonical/claim-task",
      body: {},
    });
    const stateMod = await import(path.join(repoRoot, "scripts/lib/dispatcher-state.js"));
    const attempt = stateMod.loadRuntimeState(stateDir).taskAttempts[0];
    const startResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/codex-canonical/start-task",
      body: {
        taskId,
        attemptId: attempt.attemptId,
        leaseToken: attempt.leaseToken,
        protocolVersion: attempt.protocolVersion,
        traceId: attempt.traceId,
        idempotencyKey: attempt.idempotencyKey,
      },
    });
    expect(startResponse.status).toBe(200);

    const response = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/codex-canonical/result",
      body: {
        attemptId: attempt.attemptId,
        leaseToken: attempt.leaseToken,
        protocolVersion: attempt.protocolVersion,
        traceId: attempt.traceId,
        idempotencyKey: attempt.idempotencyKey,
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
    expect(response.json.task.trace_id).toBe("trace-dispatch-1-task-1");
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
    expect(firstFetch.json.task.attempt_id).toBeTruthy();
    expect(firstFetch.json.task.lease_token).toBeTruthy();
    expect(firstFetch.json.task.protocol_version).toBe("2026-05-v1");
    expect(firstFetch.json.task.trace_id).toBeTruthy();
    expect(firstFetch.json.task.idempotency_key).toBeTruthy();

    const staleStart = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/start-task",
      body: {
        worker_id: "trae-retry",
        task_id: taskId,
        attempt_id: firstFetch.json.task.attempt_id,
        lease_token: "stale-token",
        protocol_version: firstFetch.json.task.protocol_version,
        trace_id: firstFetch.json.task.trace_id,
        idempotency_key: firstFetch.json.task.idempotency_key,
      },
    });
    expect(staleStart.status).toBe(409);
    expect(staleStart.json.error).toMatch(/lease token mismatch/i);

    const traceMismatchStart = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/start-task",
      body: {
        worker_id: "trae-retry",
        task_id: taskId,
        attempt_id: firstFetch.json.task.attempt_id,
        lease_token: firstFetch.json.task.lease_token,
        protocol_version: firstFetch.json.task.protocol_version,
        trace_id: "stale-trace",
        idempotency_key: firstFetch.json.task.idempotency_key,
      },
    });
    expect(traceMismatchStart.status).toBe(409);
    expect(traceMismatchStart.json.error).toMatch(/trace id mismatch/i);

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/start-task",
      body: {
        worker_id: "trae-retry",
        task_id: taskId,
        attempt_id: firstFetch.json.task.attempt_id,
        lease_token: firstFetch.json.task.lease_token,
        protocol_version: firstFetch.json.task.protocol_version,
        trace_id: firstFetch.json.task.trace_id,
        idempotency_key: firstFetch.json.task.idempotency_key,
      },
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

  it("rejects Trae start-task without a complete v1 envelope", async () => {
    const stateDir = makeTempDir();
    const repoDir = path.join(stateDir, "repo");
    fs.mkdirSync(repoDir, { recursive: true });
    const mod = await import(serverModulePath);

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/heartbeat",
      body: { worker_id: "trae-empty-envelope" },
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
            id: "task-empty-envelope",
            title: "Reject empty envelope",
            pool: "trae",
            dependsOn: [],
            branchName: "ai/trae/task-empty-envelope",
          },
        ],
        packages: [
          {
            taskId: "task-empty-envelope",
            assignment: {
              taskId: "task-empty-envelope",
              workerId: "trae-empty-envelope",
              pool: "trae",
              status: "assigned",
              branchName: "ai/trae/task-empty-envelope",
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
      body: { worker_id: "trae-empty-envelope", repo_dir: repoDir },
    });
    const response = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/start-task",
      body: {
        worker_id: "trae-empty-envelope",
        task_id: fetchResponse.json.task.task_id,
      },
    });

    expect(response.status).toBe(400);
    expect(response.json.error).toMatch(/worker protocol v1 envelope incomplete/i);
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
    expect(fetchResponse.json.task.attempt_id).toBeTruthy();
    expect(fetchResponse.json.task.lease_token).toBeTruthy();
    expect(fetchResponse.json.task.protocol_version).toBe("2026-05-v1");
    expect(fetchResponse.json.task.trace_id).toBeTruthy();
    expect(fetchResponse.json.task.idempotency_key).toBeTruthy();

    const staleResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/submit-result",
      body: {
        task_id: taskId,
        attempt_id: fetchResponse.json.task.attempt_id,
        lease_token: "stale-token",
        protocol_version: fetchResponse.json.task.protocol_version,
        trace_id: fetchResponse.json.task.trace_id,
        idempotency_key: fetchResponse.json.task.idempotency_key,
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
    expect(staleResponse.status).toBe(409);
    expect(staleResponse.json.error).toMatch(/lease token mismatch/i);

    const idempotencyMismatchResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/submit-result",
      body: {
        task_id: taskId,
        attempt_id: fetchResponse.json.task.attempt_id,
        lease_token: fetchResponse.json.task.lease_token,
        protocol_version: fetchResponse.json.task.protocol_version,
        trace_id: fetchResponse.json.task.trace_id,
        idempotency_key: "stale-idempotency-key",
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
    expect(idempotencyMismatchResponse.status).toBe(409);
    expect(idempotencyMismatchResponse.json.error).toMatch(/idempotency key mismatch/i);

    const response = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/submit-result",
      body: {
        task_id: taskId,
        attempt_id: fetchResponse.json.task.attempt_id,
        lease_token: fetchResponse.json.task.lease_token,
        protocol_version: fetchResponse.json.task.protocol_version,
        trace_id: fetchResponse.json.task.trace_id,
        idempotency_key: fetchResponse.json.task.idempotency_key,
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
        artifact_bundle: {
          bundleId: "bundle-trae-artifact",
          taskId,
          attemptId: fetchResponse.json.task.attempt_id,
          schemaVersion: "artifact-bundle/v1",
          summary: "Trae artifact ready",
          changedFiles: [],
          refs: {
            structuredReport: `artifact://${fetchResponse.json.task.attempt_id}/result.json`,
          },
          retainedContent: {
            diff: "diff --git a/docs/test.md b/docs/test.md",
            logs: "trae log",
            testResults: "PASS",
          },
          riskNotes: [],
          nextActions: [],
          createdAt: "2026-06-12T10:00:00.000Z",
        },
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

    const artifactResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/api/artifacts/bundle-trae-artifact",
    });
    expect(artifactResponse.json.refs.diff).toBe("artifact://bundle-trae-artifact/diff.patch");

    const diffResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/api/artifacts/bundle-trae-artifact/files/diff.patch",
    });
    expect(diffResponse.status).toBe(200);
    expect(diffResponse.json.content).toBe("diff --git a/docs/test.md b/docs/test.md");
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
        attempt_id: fetchResponse.json.task.attempt_id,
        lease_token: fetchResponse.json.task.lease_token,
        protocol_version: fetchResponse.json.task.protocol_version,
        trace_id: fetchResponse.json.task.trace_id,
        idempotency_key: fetchResponse.json.task.idempotency_key,
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

  it("rejects malformed JSON request bodies before route handling", async () => {
    const mod = await import(serverModulePath);

    await expect(mod.readJsonBody(Readable.from(["{broken"]))).rejects.toMatchObject({
      code: "invalid_json_body",
      status: 400,
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

  it("marks workers offline immediately via API", async () => {
    const stateDir = makeTempDir();
    const mod = await import(serverModulePath);

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/register",
      body: {
        workerId: "test-worker-offline-1",
        pool: "trae",
        hostname: "test-host",
        labels: ["test"],
        repoDir: "/test",
        at: "2026-04-08T11:40:28.471Z",
      },
    });

    const offlineResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/test-worker-offline-1/offline",
      body: {
        at: "2026-04-08T11:45:26.000Z",
        reason: "runtime_restart",
      },
    });
    expect(offlineResponse.status).toBe(200);
    expect(offlineResponse.json.status).toBe("offline");

    const worker = offlineResponse.json.workers.find((w: { id: string }) => w.id === "test-worker-offline-1");
    expect(worker).toMatchObject({
      id: "test-worker-offline-1",
      status: "offline",
      lastHeartbeatAt: "2026-04-08T11:45:26.000Z",
    });

    const snapshotResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/api/dashboard/snapshot",
    });
    expect(snapshotResponse.status).toBe(200);
    expect(snapshotResponse.json.stats.workers.offline).toBe(1);
    expect(snapshotResponse.json.stats.workers.idle).toBe(0);
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

  it("cancels tasks via API and releases the assigned worker", async () => {
    const stateDir = makeTempDir();
    const mod = await import(serverModulePath);

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/register",
      body: {
        workerId: "cancel-worker-1",
        pool: "codex",
        hostname: "test-host",
        labels: ["test"],
        repoDir: "/test",
      },
    });

    const dispatchResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/dispatches",
      body: {
        repo: "TingRuDeng/forgeflow-platform",
        defaultBranch: "main",
        requestedBy: "codex-control",
        tasks: [
          {
            id: "cancel-task-1",
            title: "Cancel task from API",
            pool: "codex",
            allowedPaths: ["src/**"],
            acceptance: ["pnpm test"],
            dependsOn: [],
            branchName: "ai/codex/cancel-task-1",
            verification: { mode: "run" },
          },
        ],
        packages: [
          {
            taskId: "cancel-task-1",
            assignment: {
              taskId: "cancel-task-1",
              workerId: null,
              pool: "codex",
              status: "pending",
              branchName: "ai/codex/cancel-task-1",
              repo: "TingRuDeng/forgeflow-platform",
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
      pathname: "/api/workers/cancel-worker-1/claim-task",
      body: { at: "2026-04-08T10:10:00.000Z" },
    });
    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/cancel-worker-1/start-task",
      body: { taskId, at: "2026-04-08T10:10:01.000Z" },
    });

    const cancelResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: `/api/tasks/${encodeURIComponent(taskId)}/cancel`,
      body: {
        actor: "codex-control",
        reason: "voided in console",
        at: "2026-04-08T10:10:02.000Z",
      },
    });

    expect(cancelResponse.status).toBe(200);
    expect(cancelResponse.json.status).toBe("cancelled");
    expect(cancelResponse.json.task).toMatchObject({
      id: taskId,
      status: "cancelled",
    });
    expect(cancelResponse.json.workers.find((candidate: { id: string }) => candidate.id === "cancel-worker-1")?.currentTaskId).toBeUndefined();

    const snapshotResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/api/dashboard/snapshot",
    });

    const task = snapshotResponse.json.tasks.find((candidate: { id: string }) => candidate.id === taskId);
    const worker = snapshotResponse.json.workers.find((candidate: { id: string }) => candidate.id === "cancel-worker-1");
    expect(task).toMatchObject({
      status: "cancelled",
    });
    expect(worker?.currentTaskId).toBeUndefined();
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

    it("rejects unauthenticated POST requests before parsing the request body", async () => {
      process.env.DISPATCHER_API_TOKEN = "test-secret-token";
      delete process.env.DISPATCHER_AUTH_MODE;
      const stateDir = makeTempDir();
      const mod = await import(serverModulePath);
      const instance = await mod.startDispatcherServer({
        host: "127.0.0.1",
        port: 0,
        stateDir,
      });

      try {
        const response = await fetch(`${instance.baseUrl}/api/dispatches`, {
          method: "POST",
          body: "{broken",
        });

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({
          error: "unauthorized",
        });
      } finally {
        await instance.close();
      }
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
