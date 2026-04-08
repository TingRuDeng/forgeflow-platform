import { describe, expect, it, vi } from "vitest";

import { readAssignmentQueueCounts, syncAssignmentQueueShadow } from "../src/index.js";

describe("dispatcher-queue-postgres", () => {
  it("syncs queue rows and reports grouped counts", async () => {
    const query = vi.fn(async (sql: string) => {
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
});
