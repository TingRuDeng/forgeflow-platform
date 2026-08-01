import { describe, expect, it } from "vitest";

import { describeRuntimeEventWindow } from "../../../src/modules/server/runtime-events.js";

describe("runtime event window", () => {
  it("reports chronological boundaries when events arrive out of timestamp order", () => {
    const window = describeRuntimeEventWindow([
      {
        taskId: "task-1",
        type: "created",
        at: "2026-08-01T08:00:00.000Z",
      },
      {
        taskId: "task-1",
        type: "worker_observation",
        at: "2026-06-08T00:00:00.000Z",
      },
    ]);

    expect(window).toMatchObject({
      oldestAt: "2026-06-08T00:00:00.000Z",
      newestAt: "2026-08-01T08:00:00.000Z",
    });
  });
});
