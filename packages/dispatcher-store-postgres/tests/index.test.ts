import crypto from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  applyShadowProjection,
  listRuntimeAuditEvents,
  loadPrimaryRuntimeStateSnapshot,
  RuntimeStateRevisionConflictError,
  readShadowProjectionCounts,
  savePrimaryRuntimeStateSnapshot,
} from "../src/index.js";

function sha256Json(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

describe("dispatcher-store-postgres", () => {
  it("applies projection rows and updates metadata", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT source_revision")) {
        return { rows: [{ source_revision: 0, content_sha256: null }] };
      }
      if (sql.includes("SELECT table_name")) {
        if (sql.includes("content_sha256")) {
          return { rows: [] };
        }
        return {
          rows: [
            { table_name: "dispatcher_tasks", row_count: 2 },
          ],
        };
      }
      return { rows: [] };
    });
    const client = { query };

    await applyShadowProjection(client, {
      tables: [
        {
          name: "dispatcher_tasks",
          truncateSql: "TRUNCATE dispatcher_tasks",
          insertSql: "INSERT INTO dispatcher_tasks VALUES ($1)",
          rows: [["task-1"], ["task-2"]],
        },
      ],
      counts: {
        dispatcher_tasks: 2,
      },
      sourceRevision: 1,
    });

    expect(query).toHaveBeenCalledWith("BEGIN");
    expect(query).toHaveBeenCalledWith("TRUNCATE dispatcher_tasks");
    expect(query).toHaveBeenCalledWith("INSERT INTO dispatcher_tasks VALUES ($1)", ["task-1"]);
    expect(query).toHaveBeenCalledWith("INSERT INTO dispatcher_tasks VALUES ($1)", ["task-2"]);
    expect(query).toHaveBeenCalledWith("COMMIT");

    const counts = await readShadowProjectionCounts(client);
    expect(counts.dispatcher_tasks).toBe(2);
    expect(counts.__snapshot__).toBeUndefined();
    expect(query).toHaveBeenCalledWith(expect.stringContaining("WHERE table_name <> '__snapshot__'"));
  });

  it("advances the source revision without rewriting an unchanged table", async () => {
    const rows = [["task-1"], ["task-2"]];
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT source_revision")) {
        return { rows: [{ source_revision: 1, content_sha256: "prior-snapshot" }] };
      }
      if (sql.includes("SELECT table_name, content_sha256")) {
        return {
          rows: [{
            table_name: "dispatcher_tasks",
            content_sha256: sha256Json(rows),
          }],
        };
      }
      return { rows: [] };
    });

    const result = await applyShadowProjection({ query }, {
      tables: [{
        name: "dispatcher_tasks",
        truncateSql: "TRUNCATE dispatcher_tasks",
        insertSql: "INSERT INTO dispatcher_tasks VALUES ($1)",
        rows,
      }],
      counts: { dispatcher_tasks: 2 },
      sourceRevision: 2,
    });

    expect(result).toEqual({ applied: true, stale: false, sourceRevision: 2 });
    expect(query).not.toHaveBeenCalledWith("TRUNCATE dispatcher_tasks");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("UPDATE dispatcher_shadow_projection_meta"), [
      2,
      2,
      expect.any(String),
    ]);
  });

  it("ignores a stale projection snapshot without rewriting tables", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT source_revision")) {
        return { rows: [{ source_revision: 5, content_sha256: "newer-snapshot" }] };
      }
      return { rows: [] };
    });

    const result = await applyShadowProjection({ query }, {
      tables: [{
        name: "dispatcher_tasks",
        truncateSql: "TRUNCATE dispatcher_tasks",
        insertSql: "INSERT INTO dispatcher_tasks VALUES ($1)",
        rows: [["task-1"]],
      }],
      counts: { dispatcher_tasks: 1 },
      sourceRevision: 4,
    });

    expect(result).toEqual({ applied: false, stale: true, sourceRevision: 4 });
    expect(query).not.toHaveBeenCalledWith("TRUNCATE dispatcher_tasks");
    expect(query).toHaveBeenCalledWith("COMMIT");
  });

  it("rejects different content for the same projection revision", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT source_revision")) {
        return { rows: [{ source_revision: 3, content_sha256: "different" }] };
      }
      return { rows: [] };
    });

    await expect(applyShadowProjection({ query }, {
      tables: [],
      counts: {},
      sourceRevision: 3,
    })).rejects.toBeInstanceOf(RuntimeStateRevisionConflictError);
    expect(query).toHaveBeenCalledWith("ROLLBACK");
  });

  it("saves and loads the primary runtime state snapshot", async () => {
    const storedState = {
      version: 1,
      sequence: 7,
      updatedAt: "2026-07-05T10:00:00.000Z",
      tasks: [{ id: "task-1" }],
    };
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("INSERT INTO dispatcher_runtime_state")) {
        return { rows: [{ revision: 1 }] };
      }
      if (sql.includes("SELECT revision, payload_json")) {
        return { rows: [{ revision: 1, payload_json: storedState }] };
      }
      return { rows: [], params };
    });
    const client = { query };

    const savedRevision = await savePrimaryRuntimeStateSnapshot(client, storedState, null, [{
      eventId: "event-1",
      taskId: "task-1",
      attemptId: "task-1:attempt-1",
      workerId: "worker-1",
      traceId: "trace-1",
      type: "task_created",
      at: storedState.updatedAt,
      payload: { source: "test" },
    }]);
    const loaded = await loadPrimaryRuntimeStateSnapshot<typeof storedState>(client);

    expect(savedRevision).toBe(1);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("CREATE TABLE IF NOT EXISTS dispatcher_runtime_state"));
    expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO dispatcher_runtime_state"), [
      7,
      JSON.stringify(storedState),
      "2026-07-05T10:00:00.000Z",
    ]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO dispatcher_runtime_audit_events"), [
      "event-1",
      "task-1",
      "task-1:attempt-1",
      "worker-1",
      "trace-1",
      "task_created",
      storedState.updatedAt,
      null,
      JSON.stringify({ source: "test" }),
    ]);
    expect(query).toHaveBeenCalledWith("COMMIT");
    expect(loaded).toEqual(storedState);
  });

  it("lists durable audit events with a backwards cursor", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("COUNT(*)")) {
        return { rows: [{ count: "3" }] };
      }
      if (sql.includes("SELECT audit_sequence")) {
        return {
          rows: [
            {
              audit_sequence: "3",
              event_id: "event-3",
              task_id: "task-3",
              attempt_id: "task-3:attempt-1",
              worker_id: "worker-3",
              trace_id: "trace-3",
              event_type: "task_completed",
              event_at: "2026-07-05T10:03:00.000Z",
              summary: null,
              payload_json: { ok: true },
            },
            {
              audit_sequence: "2",
              event_id: "event-2",
              task_id: "task-2",
              event_type: "task_started",
              event_at: "2026-07-05T10:02:00.000Z",
              summary: "started",
              payload_json: null,
            },
            {
              audit_sequence: "1",
              event_id: "event-1",
              task_id: "task-1",
              event_type: "task_created",
              event_at: "2026-07-05T10:01:00.000Z",
              summary: null,
              payload_json: null,
            },
          ],
        };
      }
      return { rows: [] };
    });

    const page = await listRuntimeAuditEvents({ query }, { limit: 2 });

    expect(page).toEqual({
      events: [
        expect.objectContaining({ eventId: "event-2", auditSequence: 2 }),
        expect.objectContaining({ eventId: "event-3", auditSequence: 3 }),
      ],
      total: 3,
      limit: 2,
      hasMore: true,
      nextBeforeSequence: 2,
    });
    expect(page.events[1]).toMatchObject({
      attemptId: "task-3:attempt-1",
      workerId: "worker-3",
      traceId: "trace-3",
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("LIMIT $1"), [3]);
  });

  it("rolls back the snapshot when an audit append fails", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("INSERT INTO dispatcher_runtime_state")) {
        return { rows: [{ revision: 1 }] };
      }
      if (sql.trimStart().startsWith("INSERT INTO dispatcher_runtime_audit_events")) {
        throw new Error("audit write failed");
      }
      return { rows: [] };
    });

    await expect(savePrimaryRuntimeStateSnapshot(
      { query },
      { sequence: 1 },
      null,
      [{
        eventId: "event-1",
        taskId: "task-1",
        type: "task_created",
        at: "2026-07-05T10:01:00.000Z",
      }],
    )).rejects.toThrow("audit write failed");

    expect(query).toHaveBeenCalledWith("BEGIN");
    expect(query).toHaveBeenCalledWith("ROLLBACK");
    expect(query).not.toHaveBeenCalledWith("COMMIT");
  });

  it("rolls back when a stale primary writer loses the revision CAS", async () => {
    const query = vi.fn(async () => ({ rows: [] }));

    await expect(savePrimaryRuntimeStateSnapshot(
      { query },
      { sequence: 9 },
      3,
    )).rejects.toMatchObject({
      code: "runtime_state_revision_conflict",
      expectedRevision: 3,
      status: 409,
    });

    expect(query).toHaveBeenCalledWith(expect.stringContaining("WHERE id = 1 AND revision = $4"), [
      9,
      JSON.stringify({ sequence: 9 }),
      null,
      3,
    ]);
    expect(query).toHaveBeenCalledWith("ROLLBACK");
    expect(query).not.toHaveBeenCalledWith("COMMIT");
  });
});
