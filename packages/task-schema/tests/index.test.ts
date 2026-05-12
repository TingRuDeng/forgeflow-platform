import { describe, expect, it } from "vitest";

import {
  AssignmentPayloadSchema,
  ProjectConfigSchema,
  ReviewFindingSchema,
  RunResultSchema,
  TaskSchema,
  TaskStatusSchema,
  WorkerPoolSchema,
  WorkerSchema,
} from "../src/index.js";

describe("ProjectConfigSchema", () => {
  it("fails when project.repo is missing", () => {
    const result = ProjectConfigSchema.safeParse({
      project: {
        key: "repo-a",
        default_branch: "main",
      },
      routing: {
        codex: ["apps/api/**"],
      },
      commands: {
        test: "pnpm test",
      },
      governance: {},
    });

    expect(result.success).toBe(false);
  });

  it("fails when routing is missing", () => {
    const result = ProjectConfigSchema.safeParse({
      project: {
        key: "repo-a",
        repo: "org/repo-a",
        default_branch: "main",
      },
      commands: {
        test: "pnpm test",
      },
      governance: {},
    });

    expect(result.success).toBe(false);
  });

  it("applies defaults for worktree and observability", () => {
    const result = ProjectConfigSchema.parse({
      project: {
        key: "repo-a",
        repo: "org/repo-a",
        default_branch: "main",
      },
      routing: {
        codex: ["apps/api/**"],
        gemini: ["apps/web/**"],
      },
      commands: {
        test: "pnpm test",
      },
      governance: {},
    });

    expect(result.worktree.root_dir).toBe(".worktrees");
    expect(result.observability.enabled).toBe(true);
  });

  it("accepts trae as an enabled runtime worker pool", () => {
    const result = ProjectConfigSchema.parse({
      project: {
        key: "repo-a",
        repo: "org/repo-a",
        default_branch: "main",
      },
      routing: {
        codex: ["apps/api/**"],
        gemini: ["apps/web/**"],
        trae: ["apps/desktop/**"],
      },
      commands: {
        test: "pnpm test",
      },
      governance: {},
      providers: {
        enabled: ["codex", "gemini", "trae"],
      },
    });

    expect(result.providers.enabled).toContain("trae");
    expect(result.routing.trae).toEqual(["apps/desktop/**"]);
  });
});

describe("Runtime convergence schemas", () => {
  it("accepts the dispatcher runtime task shape", () => {
    const result = TaskSchema.safeParse({
      id: "task-1",
      externalTaskId: "JIRA-1",
      traceId: "trace-1",
      repo: "org/repo-a",
      defaultBranch: "main",
      title: "实现 Trae worker 调度",
      pool: "trae",
      allowedPaths: ["apps/dispatcher/**"],
      acceptance: ["调度成功"],
      dependsOn: ["task-0"],
      branchName: "codex/task-1",
      targetWorkerId: "trae-worker-1",
      verification: {
        mode: "run",
      },
      chatMode: "new",
      continuationMode: "fresh",
      continueFromTaskId: "task-0",
      followUpOfTaskId: "task-parent",
      workerChangeReason: "目标 worker 忙碌，改派 Trae",
      status: "cancelled",
      assignedWorkerId: "trae-worker-1",
      lastAssignedWorkerId: "codex-worker-1",
      requestedBy: "codex-control",
      createdAt: "2026-05-12T00:00:00.000Z",
    });

    expect(result.success).toBe(true);
  });

  it("accepts the dispatcher runtime worker shape", () => {
    const result = WorkerSchema.safeParse({
      id: "trae-worker-1",
      pool: "trae",
      status: "busy",
      hostname: "local-trae",
      labels: ["desktop", "automation"],
      repoDir: "/Volumes/Data/code/MyCode/forgeflow-platform",
      lastHeartbeatAt: "2026-05-12T00:00:00.000Z",
      currentTaskId: "task-1",
      disabledAt: "2026-05-12T00:05:00.000Z",
      disabledBy: "operator",
    });

    expect(result.success).toBe(true);
  });

  it("accepts the dispatcher assignment payload shape", () => {
    const result = AssignmentPayloadSchema.safeParse({
      taskId: "task-1",
      taskTitle: "实现 Trae worker 调度",
      taskBranchName: "codex/task-1",
      traceId: "trace-1",
      workerId: "trae-worker-1",
      pool: "trae",
      status: "assigned",
      branchName: "codex/task-1",
      allowedPaths: ["apps/dispatcher/**"],
      acceptance: ["调度成功"],
      commands: {
        test: "pnpm test",
      },
      repo: "org/repo-a",
      defaultBranch: "main",
      targetWorkerId: "trae-worker-1",
      chatMode: "new",
      continuationMode: "fresh",
      continueFromTaskId: "task-0",
      followUpOfTaskId: "task-parent",
      workerChangeReason: "目标 worker 忙碌，改派 Trae",
    });

    expect(result.success).toBe(true);
  });

  it("rejects task statuses that are not used by the runtime state machine", () => {
    expect(TaskStatusSchema.safeParse("partial_success").success).toBe(false);
    expect(TaskStatusSchema.safeParse("expired").success).toBe(false);
    expect(TaskStatusSchema.safeParse("cancelled").success).toBe(true);
  });

  it("keeps worker pools scoped to active runtime pools", () => {
    expect(WorkerPoolSchema.safeParse("trae").success).toBe(true);
    expect(WorkerPoolSchema.safeParse("claude").success).toBe(false);
  });
});

describe("Result contracts", () => {
  it("fails when run result misses required fields", () => {
    const result = RunResultSchema.safeParse({
      command: "run",
      task_id: "task-1",
    });

    expect(result.success).toBe(false);
  });

  it("fails when review finding misses required evidence", () => {
    const result = ReviewFindingSchema.safeParse({
      severity: "high",
      category: "bug",
      title: "Missing guard",
    });

    expect(result.success).toBe(false);
  });
});
