import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import {
  buildTraeWorktreeAndAssignmentDirs,
  safeTaskDirName,
  buildTraeConstraints,
  findTraeTaskForWorker,
  applyTraeSubmitResult,
  applyTraeHeartbeat,
  applyTraeReportProgress,
  applyTraeStartTask,
} from "../../../src/modules/server/runtime-dispatcher-server.js";
import type { RuntimeState, Task, Assignment, TaskAttempt } from "../../../src/modules/server/runtime-state.js";
import { createEmptyRuntimeState } from "../../../src/modules/server/runtime-state.js";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "test-task-1",
    externalTaskId: "dispatch-1:test-task-1",
    repo: "test/repo",
    defaultBranch: "main",
    title: "Test task",
    pool: "trae",
    allowedPaths: ["src/**", "tests/**"],
    acceptance: ["pnpm test"],
    dependsOn: [],
    branchName: "ai/trae/test-task-1",
    targetWorkerId: null,
    verification: { mode: "run" },
    status: "ready",
    assignedWorkerId: null,
    lastAssignedWorkerId: null,
    requestedBy: "test",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeAssignment(taskId: string, overrides: Partial<Assignment> = {}): Assignment {
  return {
    taskId,
    workerId: null,
    pool: "trae",
    status: "pending",
    assignment: {
      taskId,
      workerId: null,
      pool: "trae",
      status: "pending",
      branchName: "ai/trae/test-task-1",
      allowedPaths: ["src/**", "tests/**"],
      repo: "test/repo",
      defaultBranch: "main",
    },
    assignedAt: null,
    claimedAt: null,
    ...overrides,
  };
}

function workerEnvelope(attempt: TaskAttempt) {
  return {
    attemptId: attempt.attemptId,
    leaseToken: attempt.leaseToken,
    protocolVersion: attempt.protocolVersion,
    traceId: attempt.traceId,
    idempotencyKey: attempt.idempotencyKey,
  };
}

function activeWorkerEnvelope(state: RuntimeState, taskId: string) {
  const attempt = state.taskAttempts.find((candidate) =>
    candidate.taskId === taskId && ["leased", "running"].includes(candidate.status)
  );
  if (!attempt) {
    throw new Error(`missing active attempt for ${taskId}`);
  }
  return workerEnvelope(attempt);
}

function createFetchReadyTraeState(taskId: string, workerId = "trae-01"): RuntimeState {
  const state = createEmptyRuntimeState();
  state.tasks.push(makeTask({ id: taskId, status: "ready", assignedWorkerId: null }));
  state.assignments.push(makeAssignment(taskId));
  state.workers.push({
    id: workerId,
    pool: "trae",
    hostname: "",
    labels: [],
    repoDir: "/repo",
    status: "idle",
    lastHeartbeatAt: new Date().toISOString(),
  });
  findTraeTaskForWorker(state, workerId, "/repo");
  return state;
}

function createStartedTraeState(taskId: string, workerId = "trae-01"): RuntimeState {
  const state = createFetchReadyTraeState(taskId, workerId);
  const started = applyTraeStartTask(state, workerId, taskId, activeWorkerEnvelope(state, taskId));
  if (!started.ok) {
    throw new Error(started.error ?? "failed to start trae task");
  }
  return started.state;
}

describe("runtime-dispatcher-server foundation", () => {
  describe("safeTaskDirName", () => {
    it("returns task id as-is for simple ids", () => {
      expect(safeTaskDirName("task-1")).toBe("task-1");
      expect(safeTaskDirName("dispatch-42-phase1-test")).toBe("dispatch-42-phase1-test");
    });

    it("replaces invalid characters", () => {
      expect(safeTaskDirName("dispatch-1:task-1")).toBe("dispatch-1-task-1");
      expect(safeTaskDirName("task/with/slashes")).toBe("task-with-slashes");
    });
  });

  describe("buildTraeWorktreeAndAssignmentDirs", () => {
    it("builds dirs relative to repoDir", () => {
      const task = makeTask({ id: "task-1" });
      const result = buildTraeWorktreeAndAssignmentDirs("/state", "/repos/forgeflow", task);
      expect(result.worktree_dir).toBe("/repos/forgeflow/.worktrees/task-1");
      expect(result.assignment_dir).toBe("/repos/forgeflow/.worktrees/task-1/.orchestrator/assignments/task-1");
    });

    it("falls back to stateDir/../worktrees when repoDir is empty", () => {
      const task = makeTask({ id: "task-2" });
      const result = buildTraeWorktreeAndAssignmentDirs("/state/dir", "", task);
      expect(result.worktree_dir).toBe("/state/dir/../worktrees/task-2");
    });
  });

  describe("buildTraeConstraints", () => {
    it("returns formatted constraint strings", () => {
      const task = makeTask({
        allowedPaths: ["src/**", "tests/**"],
        acceptance: ["pnpm test", "pnpm lint"],
      });
      const constraints = buildTraeConstraints(task);
      expect(constraints).toContain("allowedPaths: src/**, tests/**");
      expect(constraints).toContain("must run acceptance: pnpm test, pnpm lint");
      expect(constraints).toContain("do not expand the scope beyond allowedPaths");
      expect(constraints).toContain("do not modify .orchestrator files");
      expect(constraints).toContain("commit and push changes before submitting result");
    });

    it("handles empty allowedPaths and acceptance", () => {
      const task = makeTask({ allowedPaths: [], acceptance: [] });
      const constraints = buildTraeConstraints(task);
      expect(constraints).toContain("allowedPaths: all");
      expect(constraints).toContain("must run acceptance: none");
    });
  });

  describe("findTraeTaskForWorker", () => {
    it("returns no task when state is empty", () => {
      const state = createEmptyRuntimeState();
      const result = findTraeTaskForWorker(state, "trae-01", "/repo");
      expect(result.task).toBeNull();
      expect(result.constraints).toEqual([]);
    });

    it("assigns ready task to worker", () => {
      const state = createEmptyRuntimeState();
      state.tasks.push(makeTask({ id: "task-ready", status: "ready", pool: "trae" }));
      state.assignments.push(makeAssignment("task-ready"));

      const result = findTraeTaskForWorker(state, "trae-01", "/repo");
      expect(result.task).not.toBeNull();
      expect(result.task!.id).toBe("task-ready");
      expect(result.task!.assignedWorkerId).toBe("trae-01");
      const worker = state.workers.find((candidate) => candidate.id === "trae-01");
      expect(worker).toBeDefined();
      expect(worker!.currentTaskId).toBe("task-ready");
    });

    it("returns in_progress task to same worker", () => {
      const state = createEmptyRuntimeState();
      state.tasks.push(makeTask({
        id: "task-in-progress",
        status: "in_progress",
        assignedWorkerId: "trae-01",
        pool: "trae",
      }));
      state.assignments.push(makeAssignment("task-in-progress", {
        status: "in_progress",
        workerId: "trae-01",
      }));

      const result = findTraeTaskForWorker(state, "trae-01", "/repo");
      expect(result.task).not.toBeNull();
      expect(result.task!.id).toBe("task-in-progress");
    });

    it("does not assign task targeted to another worker", () => {
      const state = createEmptyRuntimeState();
      state.tasks.push(makeTask({
        id: "task-targeted",
        status: "ready",
        pool: "trae",
        targetWorkerId: "trae-remote",
      }));
      state.assignments.push(makeAssignment("task-targeted"));

      const result = findTraeTaskForWorker(state, "trae-local", "/repo");
      expect(result.task).toBeNull();
    });

    it("respects targetWorkerId when worker matches", () => {
      const state = createEmptyRuntimeState();
      state.tasks.push(makeTask({
        id: "task-targeted",
        status: "ready",
        pool: "trae",
        targetWorkerId: "trae-remote",
      }));
      state.assignments.push(makeAssignment("task-targeted"));

      const result = findTraeTaskForWorker(state, "trae-remote", "/repo");
      expect(result.task).not.toBeNull();
      expect(result.task!.id).toBe("task-targeted");
    });

    it("skips non-trae pools", () => {
      const state = createEmptyRuntimeState();
      state.tasks.push(makeTask({ id: "task-codex", status: "ready", pool: "codex" }));
      state.assignments.push(makeAssignment("task-codex", { pool: "codex" }));

      const result = findTraeTaskForWorker(state, "trae-01", "/repo");
      expect(result.task).toBeNull();
    });
  });

  describe("applyTraeSubmitResult", () => {
    it("moves task to review on review_ready", () => {
      const state = createStartedTraeState("task-1");

      const result = applyTraeSubmitResult(state, {
        taskId: "task-1",
        ...activeWorkerEnvelope(state, "task-1"),
        status: "review_ready",
        summary: "Done!",
        testOutput: "PASS",
        risks: ["low"],
        filesChanged: ["src/a.ts"],
        branchName: "ai/trae/test-task-1",
        commitSha: "abc123",
        pushStatus: "success",
        prNumber: 42,
        prUrl: "https://github.com/test/repo/pull/42",
      });

      expect(result.ok).toBe(true);
      expect(result.state.tasks[0].status).toBe("review");
      expect(result.state.workers[0].status).toBe("idle");
      expect(result.state.workers[0].currentTaskId).toBeUndefined();
      const event = result.state.events.find((e) =>
        e.taskId === "task-1" && (e.payload as { to?: string } | undefined)?.to === "review"
      );
      expect(event).toBeDefined();
      expect(event!.payload).toMatchObject({
        from: "in_progress",
        to: "review",
      });
    });

    it("moves task to failed on failed status", () => {
      const state = createStartedTraeState("task-2");

      const result = applyTraeSubmitResult(state, {
        taskId: "task-2",
        ...activeWorkerEnvelope(state, "task-2"),
        status: "failed",
        summary: "Error occurred",
        branchName: "ai/trae/test-task-1",
        commitSha: "def456",
        pushStatus: "failed",
        pushError: "Permission denied",
      });

      expect(result.ok).toBe(true);
      expect(result.state.tasks[0].status).toBe("failed");
      const event = result.state.events.find((e) =>
        e.taskId === "task-2" && (e.payload as { to?: string } | undefined)?.to === "failed"
      );
      expect(event!.payload).toMatchObject({
        to: "failed",
      });
    });

    it("returns error when task not found", () => {
      const state = createEmptyRuntimeState();
      const result = applyTraeSubmitResult(state, {
        taskId: "nonexistent",
        status: "review_ready",
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBe("task_not_found");
    });

    it("writes evidence to reviews on review_ready", () => {
      const state = createStartedTraeState("task-3");

      const result = applyTraeSubmitResult(state, {
        taskId: "task-3",
        ...activeWorkerEnvelope(state, "task-3"),
        status: "review_ready",
        summary: "Done!",
        filesChanged: ["src/a.ts"],
        branchName: "ai/trae/test-task-1",
        prNumber: 42,
        prUrl: "https://github.com/test/repo/pull/42",
        evidence: {
          failureType: undefined,
          failureSummary: undefined,
          blockers: [],
          findings: [],
        },
      });

      expect(result.ok).toBe(true);
      expect(result.state.reviews).toHaveLength(1);
      expect(result.state.reviews[0].taskId).toBe("task-3");
      expect(result.state.reviews[0].latestWorkerResult).toBeDefined();
      expect(result.state.reviews[0].latestWorkerResult?.evidence).toBeDefined();
      expect(result.state.reviews[0].latestWorkerResult?.verification?.allPassed).toBe(true);
      expect(result.state.reviews[0].reviewMaterial).toBeDefined();
      expect(result.state.reviews[0].reviewMaterial?.pullRequest?.number).toBe(42);
    });

    it("includes failureType and failureSummary in failed event payload", () => {
      const state = createStartedTraeState("task-4");

      const result = applyTraeSubmitResult(state, {
        taskId: "task-4",
        ...activeWorkerEnvelope(state, "task-4"),
        status: "failed",
        summary: "pnpm test failed",
        evidence: {
          failureType: "verification",
          failureSummary: "pnpm test failed",
          blockers: [],
          findings: [],
        },
      });

      expect(result.ok).toBe(true);
      expect(result.state.tasks[0].status).toBe("failed");
      const event = result.state.events.find((e) =>
        e.taskId === "task-4" && (e.payload as { to?: string } | undefined)?.to === "failed"
      );
      expect(event).toBeDefined();
      expect(event!.payload).toMatchObject({
        to: "failed",
      });
      expect(result.state.reviews[0].latestWorkerResult?.evidence?.failureType).toBe("verification");
    });

    it("accepts a failed v1 result without optional evidence", () => {
      const state = createStartedTraeState("task-5");

      const result = applyTraeSubmitResult(state, {
        taskId: "task-5",
        ...activeWorkerEnvelope(state, "task-5"),
        status: "failed",
        summary: "Something went wrong",
      });

      expect(result.ok).toBe(true);
      expect(result.state.tasks[0].status).toBe("failed");
      const event = result.state.events.find((e) =>
        e.taskId === "task-5" && (e.payload as { to?: string } | undefined)?.to === "failed"
      );
      expect(event).toBeDefined();
      expect(event!.payload).toMatchObject({
        to: "failed",
      });
      expect((event!.payload as Record<string, unknown>).failureType).toBeUndefined();
      expect(result.state.reviews[0].latestWorkerResult?.evidence).toBeUndefined();
    });
  });

  describe("applyTraeHeartbeat", () => {
    it("registers new worker on first heartbeat", () => {
      const state = createEmptyRuntimeState();
      const result = applyTraeHeartbeat(state, "trae-new");
      expect(result.state.workers).toHaveLength(1);
      expect(result.state.workers[0].id).toBe("trae-new");
      expect(result.state.workers[0].pool).toBe("trae");
      expect(result.worker).not.toBeNull();
      expect(result.worker!.id).toBe("trae-new");
    });

    it("updates lastHeartbeatAt for existing worker", () => {
      const state = createEmptyRuntimeState();
      state.workers.push({
        id: "trae-01",
        pool: "trae",
        hostname: "",
        labels: [],
        repoDir: "/repo",
        status: "idle",
        lastHeartbeatAt: "2024-01-01T00:00:00.000Z",
      });

      const before = state.workers[0].lastHeartbeatAt;
      const result = applyTraeHeartbeat(state, "trae-01");
      expect(result.state.workers[0].lastHeartbeatAt).not.toBe(before);
    });

    it("returns an offline idle worker to idle on heartbeat", () => {
      const state = createEmptyRuntimeState();
      state.workers.push({
        id: "trae-offline",
        pool: "trae",
        hostname: "",
        labels: [],
        repoDir: "/repo",
        status: "offline",
        lastHeartbeatAt: "2024-01-01T00:00:00.000Z",
      });

      const result = applyTraeHeartbeat(state, "trae-offline");

      expect(result.worker).not.toBeNull();
      expect(result.worker!.status).toBe("idle");
      expect(result.state.workers[0].status).toBe("idle");
    });
  });

  describe("applyTraeReportProgress", () => {
    it("appends progress_reported event", () => {
      const state = createEmptyRuntimeState();
      const result = applyTraeReportProgress(state, "task-1", "Working on it...", "trae-01");
      expect(result.events).toHaveLength(1);
      expect(result.events[0].type).toBe("progress_reported");
      expect(result.events[0].payload).toEqual({ message: "Working on it...", worker_id: "trae-01" });
    });

    it("works without worker_id", () => {
      const state = createEmptyRuntimeState();
      const result = applyTraeReportProgress(state, "task-1", "Progress update");
      expect(result.events[0].payload).toEqual({ message: "Progress update", worker_id: undefined });
    });
  });

  describe("applyTraeStartTask", () => {
    it("claims then starts an assigned task", () => {
      const state = createFetchReadyTraeState("task-1");

      const result = applyTraeStartTask(state, "trae-01", "task-1", activeWorkerEnvelope(state, "task-1"));
      expect(result.ok).toBe(true);
      expect(result.state.tasks[0].status).toBe("in_progress");
      expect(result.state.assignments[0].status).toBe("in_progress");
      expect(result.state.assignments[0].claimedAt).toBeTruthy();
      expect(result.state.workers[0].status).toBe("busy");
      expect(result.state.workers[0].currentTaskId).toBe("task-1");
      const eventTypes = result.state.events.map((event) => event.type);
      expect(eventTypes).toContain("assignment_claimed");
      expect(eventTypes).toContain("status_changed");
    });

    it("returns error when worker not found", () => {
      const state = createEmptyRuntimeState();
      const result = applyTraeStartTask(state, "unknown-worker", "task-1");
      expect(result.ok).toBe(false);
      expect(result.error).toBe("worker_not_found");
      expect(result.worker).toBeNull();
    });
  });
});
