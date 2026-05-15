import { normalizeShadowMode } from "@forgeflow/dispatcher-store-core";
import { syncAssignmentQueueShadow, readAssignmentQueueCounts } from "@forgeflow/dispatcher-queue-postgres";
import { applyShadowProjection, createPgClient, readShadowProjectionCounts } from "@forgeflow/dispatcher-store-postgres";

import type { RuntimeState } from "./runtime-state.js";
import { persistRuntimeStateShadowWriteStatus, readPersistedRuntimeStateShadowWriteStatus, selectRuntimeStateShadowWriteStatus } from "./runtime-state-shadow-health.js";

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

function buildProjectionSnapshot(state: RuntimeState) {
  return {
    tables: [
      {
        name: "dispatcher_workers",
        truncateSql: "TRUNCATE dispatcher_workers",
        insertSql: `
          INSERT INTO dispatcher_workers (id, payload_json)
          VALUES ($1, $2::jsonb)
        `,
        rows: state.workers.map((worker) => [worker.id, JSON.stringify(worker)]),
      },
      {
        name: "dispatcher_tasks",
        truncateSql: "TRUNCATE dispatcher_tasks",
        insertSql: `
          INSERT INTO dispatcher_tasks (id, payload_json)
          VALUES ($1, $2::jsonb)
        `,
        rows: state.tasks.map((task) => [task.id, JSON.stringify(task)]),
      },
      {
        name: "dispatcher_assignments",
        truncateSql: "TRUNCATE dispatcher_assignments",
        insertSql: `
          INSERT INTO dispatcher_assignments (task_id, payload_json)
          VALUES ($1, $2::jsonb)
        `,
        rows: state.assignments.map((assignment) => [assignment.taskId, JSON.stringify(assignment)]),
      },
      {
        name: "dispatcher_reviews",
        truncateSql: "TRUNCATE dispatcher_reviews",
        insertSql: `
          INSERT INTO dispatcher_reviews (task_id, payload_json)
          VALUES ($1, $2::jsonb)
        `,
        rows: state.reviews.map((review) => [review.taskId, JSON.stringify(review)]),
      },
      {
        name: "dispatcher_events",
        truncateSql: "TRUNCATE dispatcher_events",
        insertSql: `
          INSERT INTO dispatcher_events (event_id, task_id, event_at, payload_json)
          VALUES ($1, $2, $3, $4::jsonb)
        `,
        rows: state.events.map((event, index) => [
          `${event.taskId}:${event.type}:${event.at}:${index}`,
          event.taskId,
          event.at,
          JSON.stringify(event),
        ]),
      },
      {
        name: "dispatcher_leases",
        truncateSql: "TRUNCATE dispatcher_leases",
        insertSql: `
          INSERT INTO dispatcher_leases (id, payload_json)
          VALUES ($1, $2::jsonb)
        `,
        rows: (state.leases ?? []).map((lease) => [lease.id, JSON.stringify(lease)]),
      },
    ],
    counts: {
      dispatcher_workers: state.workers.length,
      dispatcher_tasks: state.tasks.length,
      dispatcher_assignments: state.assignments.length,
      dispatcher_reviews: state.reviews.length,
      dispatcher_events: state.events.length,
      dispatcher_leases: (state.leases ?? []).length,
    },
  };
}

function buildQueueSnapshot(state: RuntimeState) {
  const availableAt = state.updatedAt;
  return {
    queueName: "assignment_delivery",
    rows: state.assignments
      .filter((assignment) => assignment.status === "pending" || assignment.status === "assigned")
      .map((assignment) => ({
        queueName: "assignment_delivery",
        messageId: assignment.taskId,
        taskId: assignment.taskId,
        workerId: assignment.workerId ?? null,
        status: assignment.status,
        availableAt,
        payload: assignment.assignment as unknown as Record<string, unknown>,
      })),
  };
}

async function ensureProjectionTables(client: Awaited<ReturnType<typeof createPgClient>>) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS dispatcher_workers (
      id TEXT PRIMARY KEY,
      payload_json JSONB NOT NULL
    );
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS dispatcher_tasks (
      id TEXT PRIMARY KEY,
      payload_json JSONB NOT NULL
    );
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS dispatcher_assignments (
      task_id TEXT PRIMARY KEY,
      payload_json JSONB NOT NULL
    );
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS dispatcher_reviews (
      task_id TEXT PRIMARY KEY,
      payload_json JSONB NOT NULL
    );
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS dispatcher_events (
      event_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      event_at TIMESTAMPTZ NOT NULL,
      payload_json JSONB NOT NULL
    );
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS dispatcher_leases (
      id TEXT PRIMARY KEY,
      payload_json JSONB NOT NULL
    );
  `);
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
    await ensureProjectionTables(client);
    await applyShadowProjection(client, buildProjectionSnapshot(state));
    if (queueMode !== "disabled") {
      await syncAssignmentQueueShadow(client, buildQueueSnapshot(state));
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
export async function readRuntimeStateShadowHealth(snapshotState: RuntimeState) {
  const postgresUrl = getPostgresUrl();
  const mode = getRuntimeStateShadowMode();
  const queueMode = getQueueShadowMode();
  if (!postgresUrl || mode === "disabled") {
    return {
      mode,
      queueMode,
      configured: false,
      projectionCounts: {},
      queueCounts: {},
      expectedCounts: {},
    };
  }

  const client = await createPgClient(postgresUrl);
  try {
    await ensureProjectionTables(client);
    const projectionCounts = await readShadowProjectionCounts(client);
    const queueCounts = queueMode === "disabled" ? {} : await readAssignmentQueueCounts(client);
    return {
      mode,
      queueMode,
      configured: true,
      projectionCounts,
      queueCounts,
      expectedCounts: buildProjectionSnapshot(snapshotState).counts,
    };
  } finally {
    await client.end?.();
  }
}
