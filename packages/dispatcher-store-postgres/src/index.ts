import crypto from "node:crypto";

import type { SqlProjectionSnapshot } from "@forgeflow/dispatcher-store-core";

export interface PgClientLike {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
  end?(): Promise<void>;
}

export class RuntimeStateRevisionConflictError extends Error {
  readonly code = "runtime_state_revision_conflict";
  readonly status = 409;
  readonly expectedRevision: number | null;

  constructor(expectedRevision: number | null) {
    super(`runtime state revision conflict (expected ${expectedRevision ?? "empty"})`);
    this.name = "RuntimeStateRevisionConflictError";
    this.expectedRevision = expectedRevision;
  }
}

export interface RuntimeAuditEventInput {
  eventId: string;
  taskId: string;
  type: string;
  at: string;
  summary?: string | null;
  payload?: unknown;
}

export interface RuntimeAuditEventRecord extends RuntimeAuditEventInput {
  auditSequence: number;
}

export interface RuntimeAuditEventPage {
  events: RuntimeAuditEventRecord[];
  total: number;
  limit: number;
  hasMore: boolean;
  nextBeforeSequence: number | null;
}

export interface PrimaryRuntimeStateSnapshot<T> {
  state: T;
  revision: number;
}

export async function createPgClient(connectionString: string): Promise<PgClientLike> {
  const { Client } = await import("pg");
  const client = new Client({
    connectionString,
  });
  await client.connect();
  return client;
}

export async function ensureShadowProjectionTables(client: PgClientLike): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS dispatcher_shadow_projection_meta (
      table_name TEXT PRIMARY KEY,
      row_count INTEGER NOT NULL DEFAULT 0,
      source_revision BIGINT NOT NULL DEFAULT 0,
      content_sha256 TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE dispatcher_shadow_projection_meta
      ADD COLUMN IF NOT EXISTS source_revision BIGINT NOT NULL DEFAULT 0;

    ALTER TABLE dispatcher_shadow_projection_meta
      ADD COLUMN IF NOT EXISTS content_sha256 TEXT;
  `);
}

export async function ensurePrimaryRuntimeStateTables(client: PgClientLike): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS dispatcher_runtime_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      revision BIGINT NOT NULL DEFAULT 1,
      sequence BIGINT NOT NULL,
      payload_json JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS dispatcher_runtime_audit_events (
      audit_sequence BIGSERIAL PRIMARY KEY,
      event_id TEXT NOT NULL UNIQUE,
      task_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_at TEXT NOT NULL,
      summary TEXT,
      payload_json JSONB
    );

    CREATE INDEX IF NOT EXISTS dispatcher_runtime_audit_events_task_sequence_idx
      ON dispatcher_runtime_audit_events (task_id, audit_sequence);

    ALTER TABLE dispatcher_runtime_state
      ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;
  `);
}

export async function savePrimaryRuntimeStateSnapshot(
  client: PgClientLike,
  state: { sequence?: number; updatedAt?: string } & Record<string, unknown>,
  expectedRevision: number | null,
  auditEvents: RuntimeAuditEventInput[] = [],
): Promise<number> {
  if (expectedRevision !== null
    && (!Number.isSafeInteger(expectedRevision) || expectedRevision <= 0)) {
    throw new Error("expected runtime state revision must be a positive integer or null");
  }
  await ensurePrimaryRuntimeStateTables(client);
  await client.query("BEGIN");
  try {
    const snapshotResult = expectedRevision === null
      ? await client.query(`
          INSERT INTO dispatcher_runtime_state (
            id, revision, sequence, payload_json, updated_at
          )
          VALUES (1, 1, $1, $2::jsonb, COALESCE($3::timestamptz, NOW()))
          ON CONFLICT (id) DO NOTHING
          RETURNING revision
        `, [
          Number(state.sequence ?? 0),
          JSON.stringify(state),
          state.updatedAt ?? null,
        ])
      : await client.query(`
          UPDATE dispatcher_runtime_state
          SET
            revision = revision + 1,
            sequence = $1,
            payload_json = $2::jsonb,
            updated_at = COALESCE($3::timestamptz, NOW())
          WHERE id = 1 AND revision = $4
          RETURNING revision
        `, [
          Number(state.sequence ?? 0),
          JSON.stringify(state),
          state.updatedAt ?? null,
          expectedRevision,
        ]);
    const revision = Number(snapshotResult.rows[0]?.revision);
    if (!Number.isSafeInteger(revision) || revision <= 0) {
      throw new RuntimeStateRevisionConflictError(expectedRevision);
    }

    for (const event of auditEvents) {
      if (!event.eventId) {
        throw new Error("runtime audit event is missing eventId");
      }
      await client.query(`
        INSERT INTO dispatcher_runtime_audit_events (
          event_id, task_id, event_type, event_at, summary, payload_json
        )
        SELECT $1, $2, $3, $4, $5, $6::jsonb
        WHERE NOT EXISTS (
          SELECT 1
          FROM dispatcher_runtime_audit_events
          WHERE event_id = $1
        )
        ON CONFLICT (event_id) DO NOTHING
      `, [
        event.eventId,
        event.taskId,
        event.type,
        event.at,
        event.summary ?? null,
        JSON.stringify(event.payload ?? null),
      ]);
    }
    await client.query("COMMIT");
    return revision;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function loadPrimaryRuntimeStateSnapshot<T>(
  client: PgClientLike,
): Promise<T | null> {
  const snapshot = await loadPrimaryRuntimeStateSnapshotWithRevision<T>(client);
  return snapshot?.state ?? null;
}

export async function loadPrimaryRuntimeStateSnapshotWithRevision<T>(
  client: PgClientLike,
): Promise<PrimaryRuntimeStateSnapshot<T> | null> {
  await ensurePrimaryRuntimeStateTables(client);
  const result = await client.query(`
    SELECT revision, payload_json
    FROM dispatcher_runtime_state
    WHERE id = 1
  `);
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  const revision = Number(row.revision);
  if (!Number.isSafeInteger(revision) || revision <= 0) {
    throw new Error("stored runtime state revision must be a positive integer");
  }
  return {
    state: row.payload_json as T,
    revision,
  };
}

export async function listRuntimeAuditEvents(
  client: PgClientLike,
  options: { limit?: number; beforeSequence?: number } = {},
): Promise<RuntimeAuditEventPage> {
  await ensurePrimaryRuntimeStateTables(client);
  const requestedLimit = Number.isSafeInteger(options.limit) && (options.limit ?? 0) > 0
    ? options.limit ?? 500
    : 500;
  const limit = Math.min(requestedLimit, 5_000);
  const beforeSequence = Number.isSafeInteger(options.beforeSequence) && (options.beforeSequence ?? 0) > 0
    ? options.beforeSequence
    : undefined;
  const totalResult = await client.query(`
    SELECT COUNT(*) AS count
    FROM dispatcher_runtime_audit_events
  `);
  const result = beforeSequence
    ? await client.query(`
        SELECT audit_sequence, event_id, task_id, event_type, event_at, summary, payload_json
        FROM dispatcher_runtime_audit_events
        WHERE audit_sequence < $1
        ORDER BY audit_sequence DESC
        LIMIT $2
      `, [beforeSequence, limit + 1])
    : await client.query(`
        SELECT audit_sequence, event_id, task_id, event_type, event_at, summary, payload_json
        FROM dispatcher_runtime_audit_events
        ORDER BY audit_sequence DESC
        LIMIT $1
      `, [limit + 1]);
  const hasMore = result.rows.length > limit;
  const events = result.rows.slice(0, limit).reverse().map((row): RuntimeAuditEventRecord => ({
    eventId: String(row.event_id),
    auditSequence: Number(row.audit_sequence),
    taskId: String(row.task_id),
    type: String(row.event_type),
    at: String(row.event_at),
    summary: row.summary ?? null,
    payload: row.payload_json ?? null,
  }));

  return {
    events,
    total: Number(totalResult.rows[0]?.count ?? 0),
    limit,
    hasMore,
    nextBeforeSequence: hasMore ? events[0]?.auditSequence ?? null : null,
  };
}

export async function applyShadowProjection(
  client: PgClientLike,
  snapshot: SqlProjectionSnapshot,
  options: { manageTransaction?: boolean } = {},
): Promise<{ applied: boolean; stale: boolean; sourceRevision: number }> {
  await ensureShadowProjectionTables(client);
  const manageTransaction = options.manageTransaction !== false;
  const sourceRevision = Number(snapshot.sourceRevision ?? 0);
  if (!Number.isSafeInteger(sourceRevision) || sourceRevision < 0) {
    throw new Error("shadow projection sourceRevision must be a non-negative integer");
  }
  const snapshotSha256 = crypto
    .createHash("sha256")
    .update(JSON.stringify(snapshot.tables), "utf8")
    .digest("hex");
  if (manageTransaction) {
    await client.query("BEGIN");
  }
  try {
    await client.query(`
      INSERT INTO dispatcher_shadow_projection_meta (
        table_name, row_count, source_revision, content_sha256, updated_at
      )
      VALUES ('__snapshot__', 0, 0, NULL, NOW())
      ON CONFLICT (table_name) DO NOTHING
    `);
    const snapshotMeta = await client.query(`
      SELECT source_revision, content_sha256
      FROM dispatcher_shadow_projection_meta
      WHERE table_name = '__snapshot__'
      FOR UPDATE
    `);
    const currentRevision = Number(snapshotMeta.rows[0]?.source_revision ?? 0);
    const currentSha256 = snapshotMeta.rows[0]?.content_sha256
      ? String(snapshotMeta.rows[0].content_sha256)
      : null;
    if (currentRevision > sourceRevision) {
      if (manageTransaction) {
        await client.query("COMMIT");
      }
      return { applied: false, stale: true, sourceRevision };
    }
    if (currentRevision === sourceRevision && currentSha256) {
      if (currentSha256 !== snapshotSha256) {
        throw new RuntimeStateRevisionConflictError(sourceRevision);
      }
      if (manageTransaction) {
        await client.query("COMMIT");
      }
      return { applied: false, stale: false, sourceRevision };
    }

    const tableMetaResult = await client.query(`
      SELECT table_name, content_sha256
      FROM dispatcher_shadow_projection_meta
      WHERE table_name <> '__snapshot__'
    `);
    const tableHashes = new Map(
      tableMetaResult.rows.map((row) => [
        String(row.table_name),
        row.content_sha256 ? String(row.content_sha256) : null,
      ]),
    );
    for (const table of snapshot.tables) {
      const contentSha256 = crypto
        .createHash("sha256")
        .update(JSON.stringify(table.rows), "utf8")
        .digest("hex");
      if (tableHashes.get(table.name) !== contentSha256) {
        await client.query(table.truncateSql);
        for (const row of table.rows) {
          await client.query(table.insertSql, row);
        }
      }
      await client.query(`
        INSERT INTO dispatcher_shadow_projection_meta (
          table_name, row_count, source_revision, content_sha256, updated_at
        )
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (table_name)
        DO UPDATE SET
          row_count = EXCLUDED.row_count,
          source_revision = EXCLUDED.source_revision,
          content_sha256 = EXCLUDED.content_sha256,
          updated_at = EXCLUDED.updated_at
      `, [table.name, table.rows.length, sourceRevision, contentSha256]);
    }
    await client.query(`
      UPDATE dispatcher_shadow_projection_meta
      SET
        row_count = $1,
        source_revision = $2,
        content_sha256 = $3,
        updated_at = NOW()
      WHERE table_name = '__snapshot__'
    `, [
      Object.values(snapshot.counts).reduce((sum, count) => sum + Number(count ?? 0), 0),
      sourceRevision,
      snapshotSha256,
    ]);
    if (manageTransaction) {
      await client.query("COMMIT");
    }
    return { applied: true, stale: false, sourceRevision };
  } catch (error) {
    if (manageTransaction) {
      await client.query("ROLLBACK");
    }
    throw error;
  }
}

export async function readShadowProjectionCounts(client: PgClientLike): Promise<Record<string, number>> {
  await ensureShadowProjectionTables(client);
  const result = await client.query(`
    SELECT table_name, row_count
    FROM dispatcher_shadow_projection_meta
    WHERE table_name <> '__snapshot__'
  `);
  return Object.fromEntries(result.rows.map((row: { table_name: string; row_count: number }) => [row.table_name, Number(row.row_count ?? 0)]));
}
