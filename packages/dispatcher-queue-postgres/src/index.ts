import crypto from "node:crypto";

import type { QueueSnapshot } from "@forgeflow/dispatcher-queue-core";
import {
  RuntimeStateRevisionConflictError,
  type PgClientLike,
} from "@forgeflow/dispatcher-store-postgres";

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

    CREATE TABLE IF NOT EXISTS dispatcher_assignment_queue_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      row_count INTEGER NOT NULL DEFAULT 0,
      source_revision BIGINT NOT NULL DEFAULT 0,
      content_sha256 TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export async function syncAssignmentQueueShadow(
  client: PgClientLike,
  snapshot: QueueSnapshot,
  options: { manageTransaction?: boolean } = {},
): Promise<{ applied: boolean; stale: boolean; sourceRevision: number }> {
  await ensureAssignmentQueueTable(client);
  const manageTransaction = options.manageTransaction !== false;
  const sourceRevision = Number(snapshot.sourceRevision ?? 0);
  if (!Number.isSafeInteger(sourceRevision) || sourceRevision < 0) {
    throw new Error("assignment queue sourceRevision must be a non-negative integer");
  }
  const contentSha256 = crypto
    .createHash("sha256")
    .update(JSON.stringify(snapshot.rows), "utf8")
    .digest("hex");
  if (manageTransaction) {
    await client.query("BEGIN");
  }
  try {
    await client.query(`
      INSERT INTO dispatcher_assignment_queue_meta (
        id, row_count, source_revision, content_sha256, updated_at
      )
      VALUES (1, 0, 0, NULL, NOW())
      ON CONFLICT (id) DO NOTHING
    `);
    const metaResult = await client.query(`
      SELECT source_revision, content_sha256
      FROM dispatcher_assignment_queue_meta
      WHERE id = 1
      FOR UPDATE
    `);
    const currentRevision = Number(metaResult.rows[0]?.source_revision ?? 0);
    const currentSha256 = metaResult.rows[0]?.content_sha256
      ? String(metaResult.rows[0].content_sha256)
      : null;
    if (currentRevision > sourceRevision) {
      if (manageTransaction) {
        await client.query("COMMIT");
      }
      return { applied: false, stale: true, sourceRevision };
    }
    if (currentRevision === sourceRevision && currentSha256) {
      if (currentSha256 !== contentSha256) {
        throw new RuntimeStateRevisionConflictError(sourceRevision);
      }
      if (manageTransaction) {
        await client.query("COMMIT");
      }
      return { applied: false, stale: false, sourceRevision };
    }
    if (currentSha256 !== contentSha256) {
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
    }
    await client.query(`
      UPDATE dispatcher_assignment_queue_meta
      SET
        row_count = $1,
        source_revision = $2,
        content_sha256 = $3,
        updated_at = NOW()
      WHERE id = 1
    `, [snapshot.rows.length, sourceRevision, contentSha256]);
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

export async function readAssignmentQueueCounts(client: PgClientLike): Promise<Record<string, number>> {
  await ensureAssignmentQueueTable(client);
  const result = await client.query(`
    SELECT queue_name, COUNT(*)::int AS row_count
    FROM dispatcher_assignment_queue
    GROUP BY queue_name
  `);
  return Object.fromEntries(result.rows.map((row: { queue_name: string; row_count: number }) => [row.queue_name, Number(row.row_count ?? 0)]));
}
