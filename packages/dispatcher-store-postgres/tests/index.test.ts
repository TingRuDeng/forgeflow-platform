import { describe, expect, it, vi } from "vitest";

import { applyShadowProjection, readShadowProjectionCounts } from "../src/index.js";

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
});
