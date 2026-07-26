import type { SqlProjectionSnapshot } from "@forgeflow/dispatcher-store-core";

export interface PgClientLike {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
  end?(): Promise<void>;
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
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export async function ensurePrimaryRuntimeStateTables(client: PgClientLike): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS dispatcher_runtime_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
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
  `);
}

export async function savePrimaryRuntimeStateSnapshot(
  client: PgClientLike,
  state: { sequence?: number; updatedAt?: string } & Record<string, unknown>,
  auditEvents: RuntimeAuditEventInput[] = [],
): Promise<void> {
  await ensurePrimaryRuntimeStateTables(client);
  await client.query("BEGIN");
  try {
    await client.query(`
      INSERT INTO dispatcher_runtime_state (id, sequence, payload_json, updated_at)
      VALUES (1, $1, $2::jsonb, COALESCE($3::timestamptz, NOW()))
      ON CONFLICT (id)
      DO UPDATE SET
        sequence = EXCLUDED.sequence,
        payload_json = EXCLUDED.payload_json,
        updated_at = EXCLUDED.updated_at
    `, [
      Number(state.sequence ?? 0),
      JSON.stringify(state),
      state.updatedAt ?? null,
    ]);

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
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function loadPrimaryRuntimeStateSnapshot<T>(
  client: PgClientLike,
): Promise<T | null> {
  await ensurePrimaryRuntimeStateTables(client);
  const result = await client.query(`
    SELECT payload_json
    FROM dispatcher_runtime_state
    WHERE id = 1
  `);
  const row = result.rows[0];
  return row ? row.payload_json as T : null;
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
): Promise<void> {
  await ensureShadowProjectionTables(client);
  await client.query("BEGIN");
  try {
    for (const table of snapshot.tables) {
      await client.query(table.truncateSql);
      for (const row of table.rows) {
        await client.query(table.insertSql, row);
      }
      await client.query(`
        INSERT INTO dispatcher_shadow_projection_meta (table_name, row_count, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (table_name)
        DO UPDATE SET row_count = EXCLUDED.row_count, updated_at = EXCLUDED.updated_at
      `, [table.name, table.rows.length]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function readShadowProjectionCounts(client: PgClientLike): Promise<Record<string, number>> {
  await ensureShadowProjectionTables(client);
  const result = await client.query(`
    SELECT table_name, row_count
    FROM dispatcher_shadow_projection_meta
  `);
  return Object.fromEntries(result.rows.map((row: { table_name: string; row_count: number }) => [row.table_name, Number(row.row_count ?? 0)]));
}
