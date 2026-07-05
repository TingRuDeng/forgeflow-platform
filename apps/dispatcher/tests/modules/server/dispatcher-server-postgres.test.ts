import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const client = {
    end: vi.fn(async () => {}),
  };
  const store = {
    state: null as unknown,
  };
  return {
    client,
    store,
    createPgClient: vi.fn(async () => client),
    loadPrimaryRuntimeStateSnapshot: vi.fn(async () => store.state),
    savePrimaryRuntimeStateSnapshot: vi.fn(async (_client: unknown, state: unknown) => {
      store.state = state;
    }),
  };
});

vi.mock("@forgeflow/dispatcher-store-postgres", () => ({
  createPgClient: mocks.createPgClient,
  loadPrimaryRuntimeStateSnapshot: mocks.loadPrimaryRuntimeStateSnapshot,
  savePrimaryRuntimeStateSnapshot: mocks.savePrimaryRuntimeStateSnapshot,
}));

const originalBackend = process.env.RUNTIME_STATE_BACKEND;
const originalPrimaryUrl = process.env.DISPATCHER_PRIMARY_POSTGRES_URL;
const originalAuthMode = process.env.DISPATCHER_AUTH_MODE;
const tmpRoots: string[] = [];

function restoreEnv() {
  if (originalBackend === undefined) {
    delete process.env.RUNTIME_STATE_BACKEND;
  } else {
    process.env.RUNTIME_STATE_BACKEND = originalBackend;
  }
  if (originalPrimaryUrl === undefined) {
    delete process.env.DISPATCHER_PRIMARY_POSTGRES_URL;
  } else {
    process.env.DISPATCHER_PRIMARY_POSTGRES_URL = originalPrimaryUrl;
  }
  if (originalAuthMode === undefined) {
    delete process.env.DISPATCHER_AUTH_MODE;
  } else {
    process.env.DISPATCHER_AUTH_MODE = originalAuthMode;
  }
}

async function loadServerModule() {
  return import("../../../src/modules/server/dispatcher-server.js");
}

function makeApprovedStateDir(): string {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-dispatcher-postgres-"));
  tmpRoots.push(stateDir);
  fs.writeFileSync(path.join(stateDir, "shadow-cutover-approval.json"), JSON.stringify({
    approved: true,
    approvedAt: "2026-07-05T10:00:00.000Z",
    evidenceSha256: "c".repeat(64),
    cutoverReason: "cutover_ready",
  }));
  return stateDir;
}

describe("dispatcher server postgres backend", () => {
  afterEach(() => {
    restoreEnv();
    mocks.store.state = null;
    vi.clearAllMocks();
    for (const root of tmpRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("persists route mutations through the async postgres state path", async () => {
    process.env.RUNTIME_STATE_BACKEND = "postgres";
    process.env.DISPATCHER_PRIMARY_POSTGRES_URL = "postgres://localhost/forgeflow";
    process.env.DISPATCHER_AUTH_MODE = "open";
    const stateDir = makeApprovedStateDir();
    const { handleDispatcherHttpRequest } = await loadServerModule();

    const response = await handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/register",
      body: {
        workerId: "worker-1",
        pool: "codex",
        hostname: "host-1",
        labels: [],
        repoDir: "/repo",
      },
      internalCall: true,
    });

    expect(response.status).toBe(200);
    expect(mocks.createPgClient).toHaveBeenCalledWith("postgres://localhost/forgeflow");
    expect(mocks.loadPrimaryRuntimeStateSnapshot).toHaveBeenCalledWith(mocks.client);
    expect(mocks.savePrimaryRuntimeStateSnapshot).toHaveBeenCalled();
    const savedState = mocks.savePrimaryRuntimeStateSnapshot.mock.calls[0]?.[1] as
      | { workers?: Array<{ id: string }> }
      | undefined;
    expect(savedState).toBeDefined();
    if (!savedState) {
      throw new Error("missing saved runtime state");
    }
    expect(savedState.workers?.[0]?.id).toBe("worker-1");
  });

  it("serves query endpoints from the postgres primary snapshot", async () => {
    process.env.RUNTIME_STATE_BACKEND = "postgres";
    process.env.DISPATCHER_PRIMARY_POSTGRES_URL = "postgres://localhost/forgeflow";
    process.env.DISPATCHER_AUTH_MODE = "open";
    mocks.store.state = {
      version: 1,
      updatedAt: "2026-07-05T10:00:00.000Z",
      sequence: 7,
      tasks: [{ id: "task-1", title: "Task 1" }],
      events: [{ taskId: "task-1", type: "created", at: "2026-07-05T10:00:00.000Z" }],
      reviews: [{ taskId: "task-1", decision: "pending", notes: "" }],
      leases: [{ id: "lease-1", resourceType: "assignment", resourceId: "task-1" }],
      artifactBundles: [{ bundleId: "bundle-1", taskId: "task-1", attemptId: "attempt-1", schemaVersion: "artifact-bundle-v1" }],
    };
    const stateDir = makeApprovedStateDir();
    const { handleDispatcherHttpRequest } = await loadServerModule();

    const tasksResponse = await handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/api/query/tasks",
      internalCall: true,
    });
    const artifactsResponse = await handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/api/query/artifacts",
      internalCall: true,
    });
    const healthResponse = await handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/api/query/projection-health",
      internalCall: true,
    });

    expect(tasksResponse.status).toBe(200);
    expect(tasksResponse.json).toEqual([{ id: "task-1", title: "Task 1" }]);
    expect(artifactsResponse.status).toBe(200);
    expect(artifactsResponse.json).toEqual([
      { bundleId: "bundle-1", taskId: "task-1", attemptId: "attempt-1", schemaVersion: "artifact-bundle-v1" },
    ]);
    expect(healthResponse.status).toBe(200);
    expect(healthResponse.json).toMatchObject({
      matches: true,
      expected: {
        tasks: 1,
        events: 1,
        reviews: 1,
        leases: 1,
        artifactBundles: 1,
      },
      actual: {
        tasks: 1,
        events: 1,
        reviews: 1,
        leases: 1,
        artifactBundles: 1,
      },
    });
  });
});
