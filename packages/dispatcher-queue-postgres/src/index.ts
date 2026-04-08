import type { QueueSnapshot } from "@forgeflow/dispatcher-queue-core";
import type { PgClientLike } from "@forgeflow/dispatcher-store-postgres";

export async function ensureAssignmentQueueTable(client: PgClientLike): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS dispatcher_assignment_queue (
      queue_name TEXT NOT NULL,
      message_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      worker_id TEXT,
      status TEXT NOT NULL,
      available_at TIMESTAMPTZ NOT NULL,
      payload_json JSONB NOT NULL
    );
  `);
}

export async function syncAssignmentQueueShadow(
  client: PgClientLike,
  snapshot: QueueSnapshot,
): Promise<void> {
  await ensureAssignmentQueueTable(client);
  await client.query("BEGIN");
  try {
    await client.query("TRUNCATE dispatcher_assignment_queue");
    for (const row of snapshot.rows) {
      await client.query(`
        INSERT INTO dispatcher_assignment_queue (
          queue_name, message_id, task_id, worker_id, status, available_at, payload_json
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      `, [
        row.queueName,
        row.messageId,
        row.taskId,
        row.workerId ?? null,
        row.status,
        row.availableAt,
        JSON.stringify(row.payload),
      ]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function readAssignmentQueueCounts(client: PgClientLike): Promise<Record<string, number>> {
  await ensureAssignmentQueueTable(client);
  const result = await client.query(`
    SELECT queue_name, COUNT(*)::int AS row_count
    FROM dispatcher_assignment_queue
    GROUP BY queue_name
  `);
  return Object.fromEntries(result.rows.map((row: { queue_name: string; row_count: number }) => [row.queue_name, Number(row.row_count ?? 0)]));
}
