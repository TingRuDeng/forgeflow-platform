import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const client = {
    end: vi.fn(async () => {}),
  };
  return {
    client,
    createPgClient: vi.fn(async () => client),
    loadPrimaryRuntimeStateSnapshot: vi.fn(async () => null),
    savePrimaryRuntimeStateSnapshot: vi.fn(async (_client: unknown, _state: unknown) => {}),
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

describe("dispatcher server postgres backend", () => {
  afterEach(() => {
    restoreEnv();
    vi.clearAllMocks();
  });

  it("persists route mutations through the async postgres state path", async () => {
    process.env.RUNTIME_STATE_BACKEND = "postgres";
    process.env.DISPATCHER_PRIMARY_POSTGRES_URL = "postgres://localhost/forgeflow";
    process.env.DISPATCHER_AUTH_MODE = "open";
    const { handleDispatcherHttpRequest } = await loadServerModule();

    const response = await handleDispatcherHttpRequest({
      stateDir: "unused-state-dir",
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
});
