import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const client = {
    query: vi.fn(async () => ({ rows: [] })),
    end: vi.fn(async () => {}),
  };
  return {
    client,
    createPgClient: vi.fn(async () => client),
    ensureShadowProjectionTables: vi.fn(async () => {}),
    applyShadowProjection: vi.fn(async () => ({
      applied: true,
      stale: false,
      sourceRevision: 1,
    })),
    ensureAssignmentQueueTable: vi.fn(async () => {}),
    syncAssignmentQueueShadow: vi.fn(async () => ({
      applied: true,
      stale: false,
      sourceRevision: 1,
    })),
  };
});

vi.mock("@forgeflow/dispatcher-store-postgres", () => ({
  createPgClient: mocks.createPgClient,
  ensureShadowProjectionTables: mocks.ensureShadowProjectionTables,
  applyShadowProjection: mocks.applyShadowProjection,
  readShadowProjectionCounts: vi.fn(async () => ({})),
}));

vi.mock("@forgeflow/dispatcher-queue-postgres", () => ({
  ensureAssignmentQueueTable: mocks.ensureAssignmentQueueTable,
  syncAssignmentQueueShadow: mocks.syncAssignmentQueueShadow,
  readAssignmentQueueCounts: vi.fn(async () => ({})),
}));

import { createEmptyRuntimeState } from "../../../src/modules/server/runtime-state.js";
import {
  readRuntimeStateShadowWriteStatus,
  syncRuntimeStateShadow,
} from "../../../src/modules/server/runtime-state-shadow.js";

const originalShadowMode = process.env.DISPATCHER_SHADOW_MODE;
const originalQueueShadowMode = process.env.DISPATCHER_QUEUE_SHADOW_MODE;
const originalPostgresUrl = process.env.DISPATCHER_POSTGRES_URL;

function configureShadow(): void {
  process.env.DISPATCHER_SHADOW_MODE = "shadow-write";
  process.env.DISPATCHER_QUEUE_SHADOW_MODE = "shadow-write";
  process.env.DISPATCHER_POSTGRES_URL = "postgres://localhost/forgeflow";
}

afterEach(() => {
  vi.clearAllMocks();
  mocks.applyShadowProjection.mockResolvedValue({
    applied: true,
    stale: false,
    sourceRevision: 1,
  });
  mocks.syncAssignmentQueueShadow.mockResolvedValue({
    applied: true,
    stale: false,
    sourceRevision: 1,
  });
  if (originalShadowMode === undefined) {
    delete process.env.DISPATCHER_SHADOW_MODE;
  } else {
    process.env.DISPATCHER_SHADOW_MODE = originalShadowMode;
  }
  if (originalQueueShadowMode === undefined) {
    delete process.env.DISPATCHER_QUEUE_SHADOW_MODE;
  } else {
    process.env.DISPATCHER_QUEUE_SHADOW_MODE = originalQueueShadowMode;
  }
  if (originalPostgresUrl === undefined) {
    delete process.env.DISPATCHER_POSTGRES_URL;
  } else {
    process.env.DISPATCHER_POSTGRES_URL = originalPostgresUrl;
  }
});

describe("runtime-state shadow transaction", () => {
  it("rolls back projection changes when the queue is already at a newer revision", async () => {
    configureShadow();
    mocks.syncAssignmentQueueShadow.mockResolvedValueOnce({
      applied: false,
      stale: true,
      sourceRevision: 5,
    });

    await syncRuntimeStateShadow(createEmptyRuntimeState(), 5);

    expect(mocks.applyShadowProjection).toHaveBeenCalledWith(
      mocks.client,
      expect.objectContaining({ sourceRevision: 5 }),
      { manageTransaction: false },
    );
    expect(mocks.syncAssignmentQueueShadow).toHaveBeenCalledWith(
      mocks.client,
      expect.objectContaining({ sourceRevision: 5 }),
      { manageTransaction: false },
    );
    expect(mocks.client.query).toHaveBeenCalledWith("BEGIN");
    expect(mocks.client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(mocks.client.query).not.toHaveBeenCalledWith("COMMIT");
    expect(readRuntimeStateShadowWriteStatus().status).toBe("ok");
  });

  it("commits one transaction when projection and queue accept the revision", async () => {
    configureShadow();

    await syncRuntimeStateShadow(createEmptyRuntimeState(), 6);

    expect(mocks.client.query).toHaveBeenCalledWith("BEGIN");
    expect(mocks.client.query).toHaveBeenCalledWith("COMMIT");
    expect(mocks.client.query).not.toHaveBeenCalledWith("ROLLBACK");
  });

  it("skips queue synchronization when the projection is already newer", async () => {
    configureShadow();
    mocks.applyShadowProjection.mockResolvedValueOnce({
      applied: false,
      stale: true,
      sourceRevision: 4,
    });

    await syncRuntimeStateShadow(createEmptyRuntimeState(), 4);

    expect(mocks.syncAssignmentQueueShadow).not.toHaveBeenCalled();
    expect(mocks.client.query).toHaveBeenCalledWith("COMMIT");
  });
});
