import type { SqlProjectionSnapshot } from "@forgeflow/dispatcher-store-core";

export interface PgClientLike {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
  end?(): Promise<void>;
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
