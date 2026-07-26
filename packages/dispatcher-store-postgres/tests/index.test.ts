import { describe, expect, it, vi } from "vitest";

import {
  applyShadowProjection,
  listRuntimeAuditEvents,
  loadPrimaryRuntimeStateSnapshot,
  readShadowProjectionCounts,
  savePrimaryRuntimeStateSnapshot,
} from "../src/index.js";

describe("dispatcher-store-postgres", () => {
  it("applies projection rows and updates metadata", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT table_name")) {
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
    });

    expect(query).toHaveBeenCalledWith("BEGIN");
    expect(query).toHaveBeenCalledWith("TRUNCATE dispatcher_tasks");
    expect(query).toHaveBeenCalledWith("INSERT INTO dispatcher_tasks VALUES ($1)", ["task-1"]);
    expect(query).toHaveBeenCalledWith("INSERT INTO dispatcher_tasks VALUES ($1)", ["task-2"]);
    expect(query).toHaveBeenCalledWith("COMMIT");

    const counts = await readShadowProjectionCounts(client);
    expect(counts.dispatcher_tasks).toBe(2);
  });

  it("saves and loads the primary runtime state snapshot", async () => {
    const storedState = {
      version: 1,
      sequence: 7,
      updatedAt: "2026-07-05T10:00:00.000Z",
      tasks: [{ id: "task-1" }],
    };
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("SELECT payload_json")) {
        return { rows: [{ payload_json: storedState }] };
      }
      return { rows: [], params };
    });
    const client = { query };

    await savePrimaryRuntimeStateSnapshot(client, storedState, [{
      eventId: "event-1",
      taskId: "task-1",
      type: "task_created",
      at: storedState.updatedAt,
      payload: { source: "test" },
    }]);
    const loaded = await loadPrimaryRuntimeStateSnapshot<typeof storedState>(client);

    expect(query).toHaveBeenCalledWith(expect.stringContaining("CREATE TABLE IF NOT EXISTS dispatcher_runtime_state"));
    expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO dispatcher_runtime_state"), [
      7,
      JSON.stringify(storedState),
      "2026-07-05T10:00:00.000Z",
    ]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO dispatcher_runtime_audit_events"), [
      "event-1",
      "task-1",
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
    expect(query).toHaveBeenCalledWith(expect.stringContaining("LIMIT $1"), [3]);
  });

  it("rolls back the snapshot when an audit append fails", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.trimStart().startsWith("INSERT INTO dispatcher_runtime_audit_events")) {
        throw new Error("audit write failed");
      }
      return { rows: [] };
    });

    await expect(savePrimaryRuntimeStateSnapshot(
      { query },
      { sequence: 1 },
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
});
