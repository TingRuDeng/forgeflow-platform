import { describe, expect, it } from "vitest";

import { TaskEventService } from "../../../src/modules/events/service.js";
import {
  TaskService,
  type DispatcherTask,
} from "../../../src/modules/tasks/service.js";

function buildTask(): DispatcherTask {
  return {
    id: "task-1",
    repo: "org/repo-a",
    title: "Bootstrap dispatcher",
    pool: "codex",
    allowedPaths: ["apps/dispatcher/**"],
    acceptance: ["typecheck passes"],
    dependsOn: [],
    status: "planned",
  };
}

describe("TaskService", () => {
  it("allows planned -> ready -> assigned -> in_progress", () => {
    const events = new TaskEventService();
    const service = new TaskService(events);
    const task = buildTask();

    service.create(task);
    service.transition("task-1", "ready");
    service.transition("task-1", "assigned");
    service.transition("task-1", "in_progress");

    expect(service.get("task-1")?.status).toBe("in_progress");
  });

  it("allows in_progress -> partial_success", () => {
    const events = new TaskEventService();
    const service = new TaskService(events);
    const task = buildTask();

    service.create(task);
    service.transition("task-1", "ready");
    service.transition("task-1", "assigned");
    service.transition("task-1", "in_progress");
    service.transition("task-1", "partial_success");

    expect(service.get("task-1")?.status).toBe("partial_success");
  });

  it("allows in_progress -> expired", () => {
    const events = new TaskEventService();
    const service = new TaskService(events);
    const task = buildTask();

    service.create(task);
    service.transition("task-1", "ready");
    service.transition("task-1", "assigned");
    service.transition("task-1", "in_progress");
    service.transition("task-1", "expired");

    expect(service.get("task-1")?.status).toBe("expired");
  });

  it("rejects illegal transitions", () => {
    const events = new TaskEventService();
    const service = new TaskService(events);

    service.create(buildTask());

    expect(() => service.transition("task-1", "in_progress")).toThrow(
      "illegal transition",
    );
  });

  it("records task events for each transition", () => {
    const events = new TaskEventService();
    const service = new TaskService(events);

    service.create(buildTask());
    service.transition("task-1", "ready");
    service.transition("task-1", "assigned");

    expect(events.listByTask("task-1")).toHaveLength(3);
  });
});
