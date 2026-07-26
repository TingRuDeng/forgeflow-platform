import crypto from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { readAssignmentQueueCounts, syncAssignmentQueueShadow } from "../src/index.js";

function sha256Json(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

describe("dispatcher-queue-postgres", () => {
  it("syncs queue rows and reports grouped counts", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT source_revision")) {
        return { rows: [{ source_revision: 0, content_sha256: null }] };
      }
      if (sql.includes("GROUP BY queue_name")) {
        return {
          rows: [
            { queue_name: "assignment_delivery", row_count: 1 },
          ],
        };
      }
      return { rows: [] };
    });
    const client = { query };

    await syncAssignmentQueueShadow(client, {
      queueName: "assignment_delivery",
      sourceRevision: 1,
      rows: [
        {
          queueName: "assignment_delivery",
          messageId: "message-1",
          taskId: "dispatch-1:task-1",
          workerId: "trae-local",
          status: "pending",
          availableAt: "2026-04-08T00:00:00.000Z",
          payload: { taskId: "dispatch-1:task-1" },
        },
      ],
    });

    expect(query).toHaveBeenCalledWith("BEGIN");
    expect(query).toHaveBeenCalledWith("TRUNCATE dispatcher_assignment_queue");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO dispatcher_assignment_queue"), expect.any(Array));
    expect(query).toHaveBeenCalledWith("COMMIT");

    const counts = await readAssignmentQueueCounts(client);
    expect(counts.assignment_delivery).toBe(1);
  });

  it("advances the source revision without rewriting unchanged queue rows", async () => {
    const rows = [{
      queueName: "assignment_delivery",
      messageId: "message-1",
      taskId: "dispatch-1:task-1",
      workerId: "trae-local",
      status: "pending",
      availableAt: "2026-04-08T00:00:00.000Z",
      payload: { taskId: "dispatch-1:task-1" },
    }];
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT source_revision")) {
        return {
          rows: [{
            source_revision: 1,
            content_sha256: sha256Json(rows),
          }],
        };
      }
      return { rows: [] };
    });

    const result = await syncAssignmentQueueShadow({ query }, {
      queueName: "assignment_delivery",
      sourceRevision: 2,
      rows,
    });

    expect(result).toEqual({ applied: true, stale: false, sourceRevision: 2 });
    expect(query).not.toHaveBeenCalledWith("TRUNCATE dispatcher_assignment_queue");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("UPDATE dispatcher_assignment_queue_meta"), [
      1,
      2,
      sha256Json(rows),
    ]);
  });

  it("ignores stale queue snapshots", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT source_revision")) {
        return { rows: [{ source_revision: 4, content_sha256: "newer" }] };
      }
      return { rows: [] };
    });

    const result = await syncAssignmentQueueShadow({ query }, {
      queueName: "assignment_delivery",
      sourceRevision: 3,
      rows: [],
    });

    expect(result).toEqual({ applied: false, stale: true, sourceRevision: 3 });
    expect(query).not.toHaveBeenCalledWith("TRUNCATE dispatcher_assignment_queue");
    expect(query).toHaveBeenCalledWith("COMMIT");
  });

  it("rolls back different queue content for the same source revision", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT source_revision")) {
        return { rows: [{ source_revision: 2, content_sha256: "different" }] };
      }
      return { rows: [] };
    });

    await expect(syncAssignmentQueueShadow({ query }, {
      queueName: "assignment_delivery",
      sourceRevision: 2,
      rows: [],
    })).rejects.toMatchObject({
      code: "runtime_state_revision_conflict",
      expectedRevision: 2,
      status: 409,
    });
    expect(query).toHaveBeenCalledWith("ROLLBACK");
  });
});
