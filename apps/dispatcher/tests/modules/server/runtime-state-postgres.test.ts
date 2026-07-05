import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const client = {
    end: vi.fn(async () => {}),
  };
  return {
    client,
    createPgClient: vi.fn(async () => client),
    loadPrimaryRuntimeStateSnapshot: vi.fn(async () => ({
      version: 1,
      sequence: 7,
      updatedAt: "2026-07-05T10:00:00.000Z",
      tasks: [{ id: "task-1", title: "Task 1", status: "ready" }],
    })),
    savePrimaryRuntimeStateSnapshot: vi.fn(async () => {}),
  };
});

vi.mock("@forgeflow/dispatcher-store-postgres", () => ({
  createPgClient: mocks.createPgClient,
  loadPrimaryRuntimeStateSnapshot: mocks.loadPrimaryRuntimeStateSnapshot,
  savePrimaryRuntimeStateSnapshot: mocks.savePrimaryRuntimeStateSnapshot,
}));

const originalBackend = process.env.RUNTIME_STATE_BACKEND;
const originalPrimaryUrl = process.env.DISPATCHER_PRIMARY_POSTGRES_URL;

async function loadRuntimeStateModule() {
  return import("../../../src/modules/server/runtime-state.js");
}

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
}

describe("runtime-state postgres backend", () => {
  afterEach(() => {
    restoreEnv();
    vi.clearAllMocks();
  });

  it("loads primary runtime state through the async postgres path", async () => {
    process.env.RUNTIME_STATE_BACKEND = "postgres";
    process.env.DISPATCHER_PRIMARY_POSTGRES_URL = "postgres://localhost/forgeflow";
    const { loadRuntimeStateAsync } = await loadRuntimeStateModule();

    const state = await loadRuntimeStateAsync("unused-state-dir");

    expect(mocks.createPgClient).toHaveBeenCalledWith("postgres://localhost/forgeflow");
    expect(mocks.loadPrimaryRuntimeStateSnapshot).toHaveBeenCalledWith(mocks.client);
    expect(mocks.client.end).toHaveBeenCalled();
    expect(state.sequence).toBe(7);
    expect(state.tasks[0]?.id).toBe("task-1");
    expect(state.workers).toEqual([]);
  });

  it("saves primary runtime state through the async postgres path", async () => {
    process.env.RUNTIME_STATE_BACKEND = "postgres";
    process.env.DISPATCHER_PRIMARY_POSTGRES_URL = "postgres://localhost/forgeflow";
    const { createEmptyRuntimeState, saveRuntimeStateAsync } = await loadRuntimeStateModule();
    const state = {
      ...createEmptyRuntimeState(),
      sequence: 11,
    };

    await saveRuntimeStateAsync("unused-state-dir", state);

    expect(mocks.savePrimaryRuntimeStateSnapshot).toHaveBeenCalledWith(mocks.client, state);
    expect(mocks.client.end).toHaveBeenCalled();
  });

  it("rejects sync load when postgres backend is selected", async () => {
    process.env.RUNTIME_STATE_BACKEND = "postgres";
    const { loadRuntimeState } = await loadRuntimeStateModule();

    expect(() => loadRuntimeState("unused-state-dir")).toThrow("loadRuntimeStateAsync");
  });

  it("requires an explicit primary postgres URL", async () => {
    process.env.RUNTIME_STATE_BACKEND = "postgres";
    delete process.env.DISPATCHER_PRIMARY_POSTGRES_URL;
    const { loadRuntimeStateAsync } = await loadRuntimeStateModule();

    await expect(loadRuntimeStateAsync("unused-state-dir")).rejects.toThrow("DISPATCHER_PRIMARY_POSTGRES_URL");
  });
});
