import { normalizeShadowMode } from "@forgeflow/dispatcher-store-core";
import { syncAssignmentQueueShadow, readAssignmentQueueCounts } from "@forgeflow/dispatcher-queue-postgres";
import { applyShadowProjection, createPgClient, readShadowProjectionCounts } from "@forgeflow/dispatcher-store-postgres";

import type { RuntimeState } from "./runtime-state.js";
import {
  buildAssignmentQueueExpectedCounts,
  buildAssignmentQueueShadowSnapshot,
  buildRuntimeStateProjectionSnapshot,
  ensureRuntimeStateProjectionTables,
} from "./runtime-state-shadow-snapshot.js";
import { persistRuntimeStateShadowWriteStatus, readPersistedRuntimeStateShadowWriteStatus, selectRuntimeStateShadowWriteStatus } from "./runtime-state-shadow-health.js";
import type { RuntimeStateShadowHealth } from "./runtime-state-shadow-drift.js";
export {
  evaluateRuntimeStateShadowDriftAlert,
  summarizeRuntimeStateShadowDrift,
} from "./runtime-state-shadow-drift.js";
export type {
  RuntimeStateShadowDriftAlert,
  RuntimeStateShadowDriftAlertThresholds,
  RuntimeStateShadowDriftSummary,
  RuntimeStateShadowHealth,
} from "./runtime-state-shadow-drift.js";

const SHADOW_MODE_ENV = "DISPATCHER_SHADOW_MODE";
const SHADOW_POSTGRES_URL_ENV = "DISPATCHER_POSTGRES_URL";
const SHADOW_QUEUE_MODE_ENV = "DISPATCHER_QUEUE_SHADOW_MODE";

export type RuntimeStateShadowWriteStatus = {
  status: "idle" | "skipped" | "running" | "ok" | "failed";
  mode: ReturnType<typeof normalizeShadowMode>;
  queueMode: ReturnType<typeof normalizeShadowMode>;
  configured: boolean;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
};

let shadowWriteStatus: RuntimeStateShadowWriteStatus = {
  status: "idle",
  mode: "disabled",
  queueMode: "disabled",
  configured: false,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastFailureAt: null,
  lastError: null,
};

export function getRuntimeStateShadowMode() {
  return normalizeShadowMode(process.env[SHADOW_MODE_ENV]);
}

function getQueueShadowMode() {
  return normalizeShadowMode(process.env[SHADOW_QUEUE_MODE_ENV] ?? process.env[SHADOW_MODE_ENV]);
}

function getPostgresUrl(): string | null {
  const url = process.env[SHADOW_POSTGRES_URL_ENV];
  return typeof url === "string" && url.trim().length > 0 ? url.trim() : null;
}

function formatShadowError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function updateShadowWriteStatus(next: Partial<RuntimeStateShadowWriteStatus>): void {
  shadowWriteStatus = {
    ...shadowWriteStatus,
    ...next,
  };
}

export function readRuntimeStateShadowWriteStatus(stateDir?: string): RuntimeStateShadowWriteStatus {
  const mode = getRuntimeStateShadowMode();
  const queueMode = getQueueShadowMode();
  const persistedStatus = stateDir ? readPersistedRuntimeStateShadowWriteStatus(stateDir) : null;
  const selectedStatus = selectRuntimeStateShadowWriteStatus(shadowWriteStatus, persistedStatus);
  return {
    ...selectedStatus,
    mode,
    queueMode,
    configured: mode !== "disabled" && Boolean(getPostgresUrl()),
  };
}

export async function syncRuntimeStateShadow(state: RuntimeState): Promise<void> {
  const mode = getRuntimeStateShadowMode();
  const queueMode = getQueueShadowMode();
  const postgresUrl = getPostgresUrl();
  const lastAttemptAt = new Date().toISOString();
  if (mode === "disabled" || !postgresUrl) {
    updateShadowWriteStatus({
      status: "skipped",
      mode,
      queueMode,
      configured: false,
      lastAttemptAt,
      lastError: null,
    });
    return;
  }
  if (mode === "primary") {
    updateShadowWriteStatus({
      status: "failed",
      mode,
      queueMode,
      configured: true,
      lastAttemptAt,
      lastFailureAt: lastAttemptAt,
      lastError: "primary_store_not_implemented",
    });
    throw new Error("primary_store_not_implemented");
  }

  updateShadowWriteStatus({
    status: "running",
    mode,
    queueMode,
    configured: true,
    lastAttemptAt,
    lastError: null,
  });

  let client: Awaited<ReturnType<typeof createPgClient>> | null = null;
  try {
    client = await createPgClient(postgresUrl);
    await ensureRuntimeStateProjectionTables(client);
    await applyShadowProjection(client, buildRuntimeStateProjectionSnapshot(state));
    if (queueMode !== "disabled") {
      await syncAssignmentQueueShadow(client, buildAssignmentQueueShadowSnapshot(state));
    }
    updateShadowWriteStatus({
      status: "ok",
      mode,
      queueMode,
      configured: true,
      lastSuccessAt: new Date().toISOString(),
      lastError: null,
    });
  } catch (error) {
    updateShadowWriteStatus({
      status: "failed",
      mode,
      queueMode,
      configured: true,
      lastFailureAt: new Date().toISOString(),
      lastError: formatShadowError(error),
    });
    throw error;
  } finally {
    await client?.end?.();
  }
}

export async function syncRuntimeStateShadowAndPersistStatus(stateDir: string, state: RuntimeState): Promise<void> {
  try {
    await syncRuntimeStateShadow(state);
  } finally {
    // shadow 写失败不能影响 SQLite 主链，但最后一次结果必须落到 durable health record。
    persistRuntimeStateShadowWriteStatus(stateDir, readRuntimeStateShadowWriteStatus());
  }
}

export async function readRuntimeStateShadowHealth(snapshotState: RuntimeState): Promise<RuntimeStateShadowHealth> {
  const postgresUrl = getPostgresUrl();
  const mode = getRuntimeStateShadowMode();
  const queueMode = getQueueShadowMode();
  if (!postgresUrl || mode === "disabled") {
    return {
      mode,
      queueMode,
      configured: false,
      primarySupported: false,
      projectionCounts: {},
      queueCounts: {},
      expectedCounts: {},
      expectedQueueCounts: {},
    };
  }
  if (mode === "primary") {
    return {
      mode,
      queueMode,
      configured: true,
      primarySupported: false,
      projectionCounts: {},
      queueCounts: {},
      expectedCounts: buildRuntimeStateProjectionSnapshot(snapshotState).counts,
      expectedQueueCounts: queueMode === "disabled" ? {} : buildAssignmentQueueExpectedCounts(snapshotState),
    };
  }

  const client = await createPgClient(postgresUrl);
  try {
    await ensureRuntimeStateProjectionTables(client);
    const projectionCounts = await readShadowProjectionCounts(client);
    const queueCounts = queueMode === "disabled" ? {} : await readAssignmentQueueCounts(client);
    return {
      mode,
      queueMode,
      configured: true,
      primarySupported: false,
      projectionCounts,
      queueCounts,
      expectedCounts: buildRuntimeStateProjectionSnapshot(snapshotState).counts,
      expectedQueueCounts: queueMode === "disabled" ? {} : buildAssignmentQueueExpectedCounts(snapshotState),
    };
  } finally {
    await client.end?.();
  }
}
