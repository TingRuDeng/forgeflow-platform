import { describe, expect, it, vi } from "vitest";

import {
  applyShadowProjection,
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

    await savePrimaryRuntimeStateSnapshot(client, storedState);
    const loaded = await loadPrimaryRuntimeStateSnapshot<typeof storedState>(client);

    expect(query).toHaveBeenCalledWith(expect.stringContaining("CREATE TABLE IF NOT EXISTS dispatcher_runtime_state"));
    expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO dispatcher_runtime_state"), [
      7,
      JSON.stringify(storedState),
      "2026-07-05T10:00:00.000Z",
    ]);
    expect(loaded).toEqual(storedState);
  });
});
