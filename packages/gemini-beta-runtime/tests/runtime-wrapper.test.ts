import { describe, expect, it } from "vitest";

import { prepareTaskWorktree, safeTaskDirName } from "../src/runtime/task-worktree.js";
import { createDispatcherClient, runWorkerDaemon, runWorkerDaemonCycle } from "../src/runtime/worker-daemon.js";

describe("gemini runtime core wrappers", () => {
  it("keeps the historical runtime exports available", () => {
    expect(typeof createDispatcherClient).toBe("function");
    expect(typeof runWorkerDaemon).toBe("function");
    expect(typeof runWorkerDaemonCycle).toBe("function");
    expect(typeof prepareTaskWorktree).toBe("function");
    expect(safeTaskDirName("task/one")).toBe("task-one");
  });
});
