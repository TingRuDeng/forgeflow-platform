import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { RuntimeStateShadowWriteStatus } from "../../../src/modules/server/runtime-state-shadow.js";
import {
  evaluateRuntimeStateShadowDriftAlert,
  summarizeRuntimeStateShadowDrift,
  syncRuntimeStateShadow,
} from "../../../src/modules/server/runtime-state-shadow.js";
import { createEmptyRuntimeState } from "../../../src/modules/server/runtime-state.js";
import {
  readPersistedRuntimeStateShadowWriteStatus,
  selectRuntimeStateShadowWriteStatus,
  SHADOW_WRITE_STATUS_FILE,
} from "../../../src/modules/server/runtime-state-shadow-health.js";

const originalShadowMode = process.env.DISPATCHER_SHADOW_MODE;
const originalQueueShadowMode = process.env.DISPATCHER_QUEUE_SHADOW_MODE;
const originalPostgresUrl = process.env.DISPATCHER_POSTGRES_URL;

function status(input: Partial<RuntimeStateShadowWriteStatus>): RuntimeStateShadowWriteStatus {
  return {
    status: "idle",
    mode: "disabled",
    queueMode: "disabled",
    configured: false,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastError: null,
    ...input,
  };
}

afterEach(() => {
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

describe("runtime-state-shadow-health", () => {
  it("keeps the live running status instead of showing a stale persisted failure", () => {
    const selected = selectRuntimeStateShadowWriteStatus(
      status({ status: "running", lastAttemptAt: "2026-05-15T01:00:00.000Z" }),
      status({
        status: "failed",
        lastAttemptAt: "2026-05-15T00:59:00.000Z",
        lastError: "old failure",
      }),
    );

    expect(selected.status).toBe("running");
    expect(selected.lastError).toBeNull();
  });

  it("uses a persisted status when live memory has no attempt data", () => {
    const selected = selectRuntimeStateShadowWriteStatus(
      status({ status: "idle", lastAttemptAt: null }),
      status({ status: "failed", lastAttemptAt: "2026-05-15T00:59:00.000Z" }),
    );

    expect(selected.status).toBe("failed");
  });

  it("surfaces a malformed persisted record as failed health", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-shadow-health-"));
    fs.writeFileSync(path.join(stateDir, SHADOW_WRITE_STATUS_FILE), "{");

    const persistedStatus = readPersistedRuntimeStateShadowWriteStatus(stateDir);
    const selected = selectRuntimeStateShadowWriteStatus(status({ lastAttemptAt: null }), persistedStatus);

    expect(persistedStatus).toMatchObject({
      status: "failed",
    });
    expect(persistedStatus?.lastAttemptAt).toEqual(expect.any(String));
    expect(persistedStatus?.lastError).toContain("failed to read shadow health record");
    expect(selected.status).toBe("failed");
  });

  it("summarizes matching shadow counts as healthy", () => {
    const drift = summarizeRuntimeStateShadowDrift({
      mode: "shadow-write",
      queueMode: "shadow-write",
      configured: true,
      primarySupported: false,
      projectionCounts: { dispatcher_tasks: 1 },
      queueCounts: { assignment_delivery: 1 },
      expectedCounts: { dispatcher_tasks: 1 },
      expectedQueueCounts: { assignment_delivery: 1 },
    });

    expect(drift.status).toBe("matched");
    expect(drift.mismatches).toEqual([]);
  });

  it("surfaces projection and queue count drift", () => {
    const drift = summarizeRuntimeStateShadowDrift({
      mode: "shadow-write",
      queueMode: "shadow-write",
      configured: true,
      primarySupported: false,
      projectionCounts: { dispatcher_tasks: 0 },
      queueCounts: { assignment_delivery: 2 },
      expectedCounts: { dispatcher_tasks: 1 },
      expectedQueueCounts: { assignment_delivery: 1 },
    });

    expect(drift.status).toBe("drifted");
    expect(drift.mismatches).toEqual([
      { store: "projection", name: "dispatcher_tasks", expected: 1, actual: 0 },
      { store: "queue", name: "assignment_delivery", expected: 1, actual: 2 },
    ]);
  });

  it("classifies drift alerts using mismatch and delta thresholds", () => {
    const drift = summarizeRuntimeStateShadowDrift({
      mode: "shadow-write",
      queueMode: "shadow-write",
      configured: true,
      primarySupported: false,
      projectionCounts: { dispatcher_tasks: 0, dispatcher_events: 7 },
      queueCounts: { assignment_delivery: 0 },
      expectedCounts: { dispatcher_tasks: 3, dispatcher_events: 1 },
      expectedQueueCounts: { assignment_delivery: 2 },
    });

    const alert = evaluateRuntimeStateShadowDriftAlert(drift, {
      maxMismatchCount: 2,
      maxAbsoluteDelta: 4,
    });

    expect(alert).toEqual({
      level: "critical",
      reasonCodes: ["shadow_drift_mismatch_count", "shadow_drift_delta"],
      mismatchCount: 3,
      absoluteDelta: 11,
    });
  });

  it("marks primary mode as unsupported until a primary store exists", () => {
    const drift = summarizeRuntimeStateShadowDrift({
      mode: "primary",
      queueMode: "primary",
      configured: true,
      primarySupported: false,
      projectionCounts: { dispatcher_tasks: 1 },
      queueCounts: { assignment_delivery: 1 },
      expectedCounts: { dispatcher_tasks: 1 },
      expectedQueueCounts: { assignment_delivery: 1 },
    });

    expect(drift).toMatchObject({
      status: "primary_unsupported",
      projectionMatches: false,
    });
  });

  it("rejects primary mode writes instead of silently shadow-writing", async () => {
    process.env.DISPATCHER_SHADOW_MODE = "primary";
    process.env.DISPATCHER_QUEUE_SHADOW_MODE = "primary";
    process.env.DISPATCHER_POSTGRES_URL = "postgres://example.invalid/forgeflow";

    await expect(syncRuntimeStateShadow(createEmptyRuntimeState())).rejects.toThrow("primary_store_not_implemented");
  });
});
