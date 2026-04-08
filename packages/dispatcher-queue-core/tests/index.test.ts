import { describe, expect, it } from "vitest";

import type { QueueSnapshot } from "../src/index.js";

describe("dispatcher-queue-core", () => {
  it("accepts a minimal queue snapshot shape", () => {
    const snapshot: QueueSnapshot = {
      queueName: "assignment_delivery",
      rows: [
        {
          queueName: "assignment_delivery",
          messageId: "task-001",
          taskId: "task-001",
          workerId: "worker-001",
          status: "pending",
          availableAt: "2026-04-08T00:00:00.000Z",
          payload: { traceId: "trace-001" },
        },
      ],
    };

    expect(snapshot.rows[0]?.messageId).toBe("task-001");
    expect(snapshot.rows[0]?.payload).toEqual({ traceId: "trace-001" });
  });
});
