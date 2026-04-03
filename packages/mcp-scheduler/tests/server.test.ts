import { describe, expect, it, vi } from "vitest";

import { createSchedulerServer } from "../src/server.js";

describe("mcp scheduler server", () => {
  it("exposes the expected scheduler tools", () => {
    const server = createSchedulerServer({
      createTasks: vi.fn(),
      listReadyTasks: vi.fn(),
      assignTask: vi.fn(),
      heartbeat: vi.fn(),
      startTask: vi.fn(),
      completeTask: vi.fn(),
      failTask: vi.fn(),
      getAssignedTask: vi.fn(),
    });

    expect(server.listTools().map((tool) => tool.name)).toEqual([
      "create_tasks",
      "list_ready_tasks",
      "assign_task",
      "heartbeat",
      "start_task",
      "complete_task",
      "fail_task",
      "get_assigned_task",
    ]);
  });

  it("delegates create_tasks", async () => {
    const createTasks = vi.fn().mockResolvedValue({ created: ["task-1"] });
    const server = createSchedulerServer({
      createTasks,
      listReadyTasks: vi.fn(),
      assignTask: vi.fn(),
      heartbeat: vi.fn(),
      startTask: vi.fn(),
      completeTask: vi.fn(),
      failTask: vi.fn(),
      getAssignedTask: vi.fn(),
    });

    const result = await server.callTool("create_tasks", {
      tasks: [
        {
          id: "task-1",
          repo: "org/repo-a",
          title: "Implement auth API",
          pool: "codex",
          allowedPaths: ["apps/api/**"],
          acceptance: ["tests pass"],
          dependsOn: [],
        },
      ],
    });

    expect(createTasks).toHaveBeenCalledWith([
      {
        id: "task-1",
        repo: "org/repo-a",
        title: "Implement auth API",
        pool: "codex",
        allowedPaths: ["apps/api/**"],
        acceptance: ["tests pass"],
        dependsOn: [],
      },
    ]);
    expect(result).toEqual({ created: ["task-1"] });
  });

  it("delegates assign_task and get_assigned_task", async () => {
    const assignTask = vi.fn().mockResolvedValue({ taskId: "task-1", workerId: "codex-1" });
    const getAssignedTask = vi.fn().mockResolvedValue({ taskId: "task-1", workerId: "codex-1" });
    const server = createSchedulerServer({
      createTasks: vi.fn(),
      listReadyTasks: vi.fn(),
      assignTask,
      heartbeat: vi.fn(),
      startTask: vi.fn(),
      completeTask: vi.fn(),
      failTask: vi.fn(),
      getAssignedTask,
    });

    const assignment = await server.callTool("assign_task", { taskId: "task-1" });
    const current = await server.callTool("get_assigned_task", { workerId: "codex-1" });

    expect(assignTask).toHaveBeenCalledWith("task-1");
    expect(getAssignedTask).toHaveBeenCalledWith("codex-1");
    expect(assignment).toEqual({ taskId: "task-1", workerId: "codex-1" });
    expect(current).toEqual({ taskId: "task-1", workerId: "codex-1" });
  });
});
