import { describe, expect, it } from "vitest";

import { DispatchService } from "../../../src/modules/dispatch/service.js";
import { TaskEventService } from "../../../src/modules/events/service.js";
import { TaskService } from "../../../src/modules/tasks/service.js";
import { WorkerService } from "../../../src/modules/workers/service.js";

function registerWorker(
  workers: WorkerService,
  id: string,
  pool: "codex" | "gemini",
  lastHeartbeatAt: string,
): void {
  workers.register({
    id,
    pool,
    status: "idle",
    lastHeartbeatAt,
  });
}

describe("DispatchService", () => {
  it("filters workers by pool and idle status", () => {
    const workers = new WorkerService();
    registerWorker(workers, "codex-1", "codex", "2026-03-16T00:00:00.000Z");
    registerWorker(workers, "gemini-1", "gemini", "2026-03-16T00:00:00.000Z");

    const service = new DispatchService(workers, new TaskService(new TaskEventService()));

    const selected = service.selectWorkerForTask("codex");
    expect(selected?.id).toBe("codex-1");
  });

  it("picks the worker idle for the longest time", () => {
    const workers = new WorkerService();
    registerWorker(workers, "codex-1", "codex", "2026-03-16T00:10:00.000Z");
    registerWorker(workers, "codex-2", "codex", "2026-03-16T00:00:00.000Z");

    const service = new DispatchService(workers, new TaskService(new TaskEventService()));

    const selected = service.selectWorkerForTask("codex");
    expect(selected?.id).toBe("codex-2");
  });

  it("uses round-robin when idle timestamps are tied", () => {
    const workers = new WorkerService();
    registerWorker(workers, "codex-1", "codex", "2026-03-16T00:00:00.000Z");
    registerWorker(workers, "codex-2", "codex", "2026-03-16T00:00:00.000Z");

    const tasks = new TaskService(new TaskEventService());
    const service = new DispatchService(workers, tasks);

    expect(service.selectWorkerForTask("codex")?.id).toBe("codex-1");
    expect(service.selectWorkerForTask("codex")?.id).toBe("codex-2");
  });

  it("assigns a ready task and marks the worker busy", () => {
    const workers = new WorkerService();
    registerWorker(workers, "codex-1", "codex", "2026-03-16T00:00:00.000Z");

    const tasks = new TaskService(new TaskEventService());
    tasks.create({
      id: "task-1",
      repo: "org/repo-a",
      title: "Implement auth API",
      pool: "codex",
      allowedPaths: ["apps/api/**"],
      acceptance: ["tests pass"],
      dependsOn: [],
      status: "planned",
    });
    tasks.transition("task-1", "ready");

    const service = new DispatchService(workers, tasks);
    const assignment = service.assignReadyTask("task-1");

    expect(assignment?.workerId).toBe("codex-1");
    expect(tasks.get("task-1")?.status).toBe("assigned");
    expect(workers.get("codex-1")?.status).toBe("busy");
  });
});
