import { describe, expect, it } from "vitest";

import { DispatchService } from "../../../src/modules/dispatch/service.js";
import { TaskEventService } from "../../../src/modules/events/service.js";
import { ExecutionService } from "../../../src/modules/execution/service.js";
import { ReviewService } from "../../../src/modules/review/service.js";
import { buildWorkerExecutionResult } from "../../../src/modules/runtime/assignment.js";
import { TaskService } from "../../../src/modules/tasks/service.js";
import { WorkerService } from "../../../src/modules/workers/service.js";

function buildTaskService(events: TaskEventService): TaskService {
  const tasks = new TaskService(events);

  tasks.create({
    id: "task-1",
    repo: "org/repo-a",
    title: "Implement auth API",
    pool: "codex",
    allowedPaths: ["src/**", "tests/**"],
    acceptance: ["pnpm test passes"],
    dependsOn: [],
    status: "planned",
  });
  tasks.transition("task-1", "ready");

  return tasks;
}

function buildWorkerService(): WorkerService {
  const workers = new WorkerService();

  workers.register({
    id: "codex-worker-1",
    pool: "codex",
    status: "idle",
    lastHeartbeatAt: "2026-03-16T00:00:00.000Z",
  });

  return workers;
}

describe("ExecutionService", () => {
  it("promotes an assigned task to review when worker verification passes", () => {
    const events = new TaskEventService();
    const tasks = buildTaskService(events);
    const workers = buildWorkerService();
    const dispatch = new DispatchService(workers, tasks);
    dispatch.assignReadyTask("task-1");

    const service = new ExecutionService(tasks, workers, new ReviewService());
    const processed = service.processWorkerResult({
      result: buildWorkerExecutionResult({
        assignment: {
          taskId: "task-1",
          workerId: "codex-worker-1",
          pool: "codex",
          status: "assigned",
          branchName: "ai/codex/task-1-auth-api",
          allowedPaths: ["src/**", "tests/**"],
          commands: {
            test: "pnpm test",
          },
          repo: "org/repo-a",
          defaultBranch: "master",
        },
        provider: "codex",
        output: "implemented auth api",
        verification: [
          {
            command: "pnpm test",
            exitCode: 0,
            output: "ok",
          },
        ],
        generatedAt: "2026-03-16T01:00:00.000Z",
      }),
      changedFiles: ["src/auth.ts", "tests/auth.test.ts"],
    });

    expect(tasks.get("task-1")?.status).toBe("review");
    expect(workers.get("codex-worker-1")).toEqual({
      id: "codex-worker-1",
      pool: "codex",
      status: "idle",
      lastHeartbeatAt: "2026-03-16T01:00:00.000Z",
    });
    expect(processed.reviewMaterial).toEqual({
      repo: "org/repo-a",
      title: "Implement auth API",
      changedFiles: ["src/auth.ts", "tests/auth.test.ts"],
      selfTestPassed: true,
      checks: ["pnpm test"],
    });
    expect(events.listByTask("task-1").map((event) => event.payload)).toContainEqual({
      from: "assigned",
      to: "in_progress",
    });
    expect(events.listByTask("task-1").map((event) => event.payload)).toContainEqual({
      from: "in_progress",
      to: "review",
    });
  });

  it("marks the task failed and frees the worker when worker verification fails", () => {
    const events = new TaskEventService();
    const tasks = buildTaskService(events);
    const workers = buildWorkerService();
    const dispatch = new DispatchService(workers, tasks);
    dispatch.assignReadyTask("task-1");

    const service = new ExecutionService(tasks, workers, new ReviewService());
    const processed = service.processWorkerResult({
      result: buildWorkerExecutionResult({
        assignment: {
          taskId: "task-1",
          workerId: "codex-worker-1",
          pool: "codex",
          status: "assigned",
          branchName: "ai/codex/task-1-auth-api",
          allowedPaths: ["src/**", "tests/**"],
          commands: {
            test: "pnpm test",
          },
          repo: "org/repo-a",
          defaultBranch: "master",
        },
        provider: "codex",
        output: "tests failed",
        verification: [
          {
            command: "pnpm test",
            exitCode: 1,
            output: "failed",
          },
        ],
        generatedAt: "2026-03-16T01:00:00.000Z",
      }),
      changedFiles: ["src/auth.ts"],
    });

    expect(tasks.get("task-1")?.status).toBe("failed");
    expect(workers.get("codex-worker-1")).toEqual({
      id: "codex-worker-1",
      pool: "codex",
      status: "idle",
      lastHeartbeatAt: "2026-03-16T01:00:00.000Z",
    });
    expect(processed.reviewMaterial).toBeUndefined();
    expect(events.listByTask("task-1").map((event) => event.payload)).toContainEqual({
      from: "in_progress",
      to: "failed",
    });
  });

  it("runs a complete minimal flow from ready to review", () => {
    const events = new TaskEventService();
    const tasks = buildTaskService(events);
    const workers = buildWorkerService();
    const dispatch = new DispatchService(workers, tasks);
    const assignment = dispatch.assignReadyTask("task-1");

    expect(assignment).toMatchObject({
      taskId: "task-1",
      workerId: "codex-worker-1",
    });
    expect(tasks.get("task-1")?.status).toBe("assigned");

    const execution = new ExecutionService(tasks, workers, new ReviewService());
    execution.processWorkerResult({
      result: buildWorkerExecutionResult({
        assignment: {
          taskId: "task-1",
          workerId: "codex-worker-1",
          pool: "codex",
          status: "assigned",
          branchName: "ai/codex/task-1-auth-api",
          allowedPaths: ["src/**", "tests/**"],
          commands: {
            test: "pnpm test",
            typecheck: "pnpm typecheck",
          },
          repo: "org/repo-a",
          defaultBranch: "master",
        },
        provider: "codex",
        output: "done",
        verification: [
          {
            command: "pnpm test",
            exitCode: 0,
            output: "ok",
          },
          {
            command: "pnpm typecheck",
            exitCode: 0,
            output: "ok",
          },
        ],
        generatedAt: "2026-03-16T01:00:00.000Z",
      }),
      changedFiles: ["src/auth.ts", "tests/auth.test.ts"],
    });

    expect(tasks.get("task-1")?.status).toBe("review");
    expect(workers.get("codex-worker-1")?.status).toBe("idle");
    expect(events.listByTask("task-1")).toHaveLength(5);
  });
});
