import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { createDispatch, createEmptyRuntimeState } from "../../../src/modules/server/runtime-state.js";
import { applyTraeReportProgress } from "../../../src/modules/server/runtime-dispatcher-server.js";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);
const stateModulePath = path.join(repoRoot, "scripts/lib/dispatcher-state.js");
const tempRoots: string[] = [];

function makeTempDir() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-dispatcher-state-"));
  tempRoots.push(tempDir);
  return tempDir;
}

afterEach(() => {
  for (const tempDir of tempRoots.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("dispatcher runtime state", () => {
  it("registers workers, dispatches tasks, processes results, and records review decisions", async () => {
    const stateDir = makeTempDir();
    const mod = await import(stateModulePath);

    let state = mod.loadRuntimeState(stateDir);
    state = mod.registerWorker(state, {
      workerId: "codex-mac-mini",
      pool: "codex",
      hostname: "mac-mini",
      labels: ["mac", "codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-16T10:00:40.000Z",
    });
    state = mod.registerWorker(state, {
      workerId: "gemini-mbp",
      pool: "gemini",
      hostname: "mbp",
      labels: ["mac", "gemini"],
      repoDir: "/repos/openclaw",
      at: "2026-03-16T10:00:45.000Z",
    });

    const dispatch = mod.createDispatch(state, {
      repo: "TingRuDeng/openclaw-multi-agent-mvp",
      defaultBranch: "master",
      requestedBy: "codex-control",
      tasks: [
        {
          id: "task-1",
          title: "实现后端鉴权 API",
          pool: "codex",
          allowedPaths: ["src/**", "tests/**"],
          acceptance: ["返回 token"],
          dependsOn: [],
          branchName: "ai/codex/task-1-auth-api",
          verification: { mode: "run" },
        },
      ],
      packages: [
        {
          taskId: "task-1",
          assignment: {
            taskId: "task-1",
            workerId: "placeholder",
            pool: "codex",
            status: "assigned",
            branchName: "ai/codex/task-1-auth-api",
            allowedPaths: ["src/**", "tests/**"],
            commands: {
              test: "pnpm test",
              build: "pnpm typecheck",
            },
            repo: "TingRuDeng/openclaw-multi-agent-mvp",
            defaultBranch: "master",
          },
          workerPrompt: "你是 codex-worker。",
          contextMarkdown: "# Context",
        },
      ],
      createdAt: "2026-03-16T10:01:00.000Z",
    });
    state = dispatch.state;

    expect(dispatch.assignments).toHaveLength(1);
    expect(dispatch.assignments[0]).toMatchObject({
      workerId: "codex-mac-mini",
      status: "assigned",
    });

    const assignedTask = mod.getAssignedTaskForWorker(state, "codex-mac-mini");
    expect(assignedTask?.assignment.taskId).toBe(dispatch.taskIds[0]);
    expect(assignedTask?.assignment.workerId).toBe("codex-mac-mini");

    state = mod.recordWorkerResult(state, {
      workerId: "codex-mac-mini",
      result: {
        taskId: dispatch.taskIds[0],
        workerId: "codex-mac-mini",
        provider: "codex",
        pool: "codex",
        branchName: "ai/codex/task-1-auth-api",
        repo: "TingRuDeng/openclaw-multi-agent-mvp",
        defaultBranch: "master",
        mode: "run",
        output: "done",
        generatedAt: "2026-03-16T10:02:00.000Z",
        verification: {
          allPassed: true,
          commands: [
            {
              command: "pnpm test",
              exitCode: 0,
              output: "ok",
            },
          ],
        },
      },
      changedFiles: ["src/auth.ts", "tests/auth.test.ts"],
      pullRequest: {
        number: 12,
        url: "https://github.com/TingRuDeng/openclaw-multi-agent-mvp/pull/12",
        headBranch: "ai/codex/task-1-auth-api",
        baseBranch: "master",
      },
    });

    const snapshotBeforeDecision = mod.buildDashboardSnapshot(state, {
      now: "2026-03-16T10:02:05.000Z",
    });
    expect(snapshotBeforeDecision.tasks[0]).toMatchObject({
      status: "review",
      assignedWorkerId: "codex-mac-mini",
    });
    expect(snapshotBeforeDecision.workers[0]).toMatchObject({
      id: "codex-mac-mini",
      status: "idle",
    });
    expect(snapshotBeforeDecision.pullRequests[0]).toMatchObject({
      number: 12,
      status: "opened",
    });

    state = mod.recordReviewDecision(state, {
      taskId: dispatch.taskIds[0],
      actor: "codex-control",
      decision: "merge",
      notes: "self test and PR review passed",
      at: "2026-03-16T10:03:00.000Z",
    });

    mod.saveRuntimeState(stateDir, state);
    const reloaded = mod.loadRuntimeState(stateDir);
    const snapshot = mod.buildDashboardSnapshot(reloaded, {
      now: "2026-03-16T10:03:05.000Z",
    });

    expect(snapshot.tasks[0]).toMatchObject({
      status: "merged",
    });
    expect(snapshot.reviews[0]).toMatchObject({
      decision: "merge",
      actor: "codex-control",
    });
    expect(snapshot.events.some((event: { payload?: { to?: string } }) => event.payload?.to === "merged")).toBe(true);
  }, 15_000);

  it("retains only the latest 500 events in immutable runtime-state appends", () => {
    const initialState = createEmptyRuntimeState();
    const taskCount = 251;
    const tasks = Array.from({ length: taskCount }, (_, index) => {
      const seq = index + 1;
      return {
        id: `task-${seq}`,
        title: `Task ${seq}`,
        pool: "codex",
        branchName: `ai/codex/task-${seq}`,
        verification: { mode: "run" as const },
      };
    });
    const packages = Array.from({ length: taskCount }, (_, index) => {
      const seq = index + 1;
      return {
        taskId: `task-${seq}`,
        assignment: {
          taskId: `task-${seq}`,
          workerId: null,
          pool: "codex",
          status: "pending" as const,
          branchName: `ai/codex/task-${seq}`,
          repo: "TingRuDeng/ForgeFlow",
          defaultBranch: "main",
        },
      };
    });

    const dispatch = createDispatch(initialState, {
      repo: "TingRuDeng/ForgeFlow",
      defaultBranch: "main",
      requestedBy: "test",
      tasks,
      packages,
      createdAt: "2026-03-30T10:00:00.000Z",
    });

    expect(dispatch.state.events).toHaveLength(500);
    expect(dispatch.state.events[0]).toMatchObject({
      taskId: `${dispatch.dispatchId}:task-2`,
      type: "created",
    });
    expect(dispatch.state.events[1]).toMatchObject({
      taskId: `${dispatch.dispatchId}:task-2`,
      type: "status_changed",
    });
    expect(dispatch.state.events[499]).toMatchObject({
      taskId: `${dispatch.dispatchId}:task-251`,
      type: "status_changed",
    });
  });

  it("retains only the latest 500 events in mutable runtime-dispatcher-server appends", () => {
    const seedState = createEmptyRuntimeState();
    const seededEvents = Array.from({ length: 500 }, (_, index) => ({
      taskId: `task-${index + 1}`,
      type: "seeded",
      at: "2026-03-30T11:00:00.000Z",
      payload: { index: index + 1 },
    }));
    const state = {
      ...seedState,
      events: seededEvents,
    };

    applyTraeReportProgress(state, "task-501", "still running", "trae-1");

    expect(state.events).toHaveLength(500);
    expect(state.events[0]).toMatchObject({
      taskId: "task-2",
      type: "seeded",
    });
    expect(state.events[499]).toMatchObject({
      taskId: "task-501",
      type: "progress_reported",
      payload: {
        message: "still running",
        worker_id: "trae-1",
      },
    });
  });

  it("marks stale workers as offline in dashboard snapshots", async () => {
    const stateDir = makeTempDir();
    const mod = await import(stateModulePath);

    let state = mod.loadRuntimeState(stateDir);
    state = mod.registerWorker(state, {
      workerId: "codex-stale",
      pool: "codex",
      hostname: "old-host",
      labels: ["codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-16T12:00:00.000Z",
    });
    state = mod.registerWorker(state, {
      workerId: "codex-fresh",
      pool: "codex",
      hostname: "new-host",
      labels: ["codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-16T12:00:50.000Z",
    });

    const snapshot = mod.buildDashboardSnapshot(state, {
      now: "2026-03-16T12:01:00.000Z",
      heartbeatTimeoutMs: 30_000,
    });

    expect(snapshot.workers.find((worker: { id: string }) => worker.id === "codex-stale")).toMatchObject({
      status: "offline",
    });
    expect(snapshot.workers.find((worker: { id: string }) => worker.id === "codex-fresh")).toMatchObject({
      status: "idle",
    });
    expect(snapshot.stats.workers).toMatchObject({
      total: 2,
      idle: 1,
      busy: 0,
      offline: 1,
    });
  });

  it("marks stale busy workers as offline in dashboard snapshots", async () => {
    const stateDir = makeTempDir();
    const mod = await import(stateModulePath);

    let state = mod.loadRuntimeState(stateDir);
    state = mod.registerWorker(state, {
      workerId: "codex-busy-stale",
      pool: "codex",
      hostname: "old-host",
      labels: ["codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-16T12:00:00.000Z",
    });
    state = {
      ...state,
      workers: state.workers.map((worker: { id: string }) => worker.id === "codex-busy-stale"
        ? {
            ...worker,
            status: "busy",
            currentTaskId: "dispatch-1:task-1",
          }
        : worker),
    };

    const snapshot = mod.buildDashboardSnapshot(state, {
      now: "2026-03-16T12:01:00.000Z",
      heartbeatTimeoutMs: 30_000,
    });

    expect(snapshot.workers.find((worker: { id: string }) => worker.id === "codex-busy-stale")).toMatchObject({
      status: "offline",
      currentTaskId: "dispatch-1:task-1",
    });
    expect(snapshot.stats.workers).toMatchObject({
      total: 1,
      idle: 0,
      busy: 0,
      offline: 1,
    });
  });

  it("reclaims assignments from stale workers before a healthy worker claims them", async () => {
    const stateDir = makeTempDir();
    const mod = await import(stateModulePath);

    let state = mod.loadRuntimeState(stateDir);
    state = mod.registerWorker(state, {
      workerId: "codex-stale-worker",
      pool: "codex",
      hostname: "old-host",
      labels: ["codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-16T12:00:00.000Z",
    });

    const dispatch = mod.createDispatch(state, {
      repo: "TingRuDeng/openclaw-multi-agent-mvp",
      defaultBranch: "master",
      requestedBy: "codex-control",
      tasks: [
        {
          id: "task-1",
          title: "补充 smoke 文档",
          pool: "codex",
          allowedPaths: ["docs/**"],
          acceptance: ["新增 smoke 文档"],
          dependsOn: [],
          branchName: "ai/codex/task-1-smoke-doc",
          verification: { mode: "run" },
        },
      ],
      packages: [
        {
          taskId: "task-1",
          assignment: {
            taskId: "task-1",
            workerId: "placeholder",
            pool: "codex",
            status: "assigned",
            branchName: "ai/codex/task-1-smoke-doc",
            allowedPaths: ["docs/**"],
            commands: {
              test: "echo ok",
            },
            repo: "TingRuDeng/openclaw-multi-agent-mvp",
            defaultBranch: "master",
          },
          workerPrompt: "你是 codex-worker。",
          contextMarkdown: "# Context",
        },
      ],
      createdAt: "2026-03-16T12:00:10.000Z",
    });
    state = dispatch.state;

    state = mod.registerWorker(state, {
      workerId: "codex-fresh-worker",
      pool: "codex",
      hostname: "new-host",
      labels: ["codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-16T12:01:00.000Z",
    });

    const claimed = mod.claimAssignedTaskForWorker(state, {
      workerId: "codex-fresh-worker",
      at: "2026-03-16T12:01:01.000Z",
      heartbeatTimeoutMs: 30_000,
    });
    state = claimed.state;

    expect(claimed.assignment?.task.id).toBe(dispatch.taskIds[0]);
    expect(claimed.assignment?.assignment.workerId).toBe("codex-fresh-worker");

    const snapshot = mod.buildDashboardSnapshot(state, {
      now: "2026-03-16T12:01:02.000Z",
      heartbeatTimeoutMs: 30_000,
    });
    expect(snapshot.tasks[0]).toMatchObject({
      status: "assigned",
      assignedWorkerId: "codex-fresh-worker",
    });
    expect(snapshot.workers.find((worker: { id: string }) => worker.id === "codex-stale-worker")).toMatchObject({
      status: "offline",
    });
    expect(snapshot.workers.find((worker: { id: string }) => worker.id === "codex-stale-worker")).not.toHaveProperty("currentTaskId");
    expect(snapshot.workers.find((worker: { id: string }) => worker.id === "codex-fresh-worker")).toMatchObject({
      status: "busy",
      currentTaskId: dispatch.taskIds[0],
    });
    expect(snapshot.events.some((event: { type: string; payload?: { from?: string; to?: string } }) =>
      event.type === "status_changed" &&
      event.payload?.from === "assigned" &&
      event.payload?.to === "ready")).toBe(true);
  });

  it("claims a ready task for a worker that registers after dispatch creation", async () => {
    const stateDir = makeTempDir();
    const mod = await import(stateModulePath);

    let state = mod.loadRuntimeState(stateDir);
    const dispatch = mod.createDispatch(state, {
      repo: "TingRuDeng/openclaw-multi-agent-mvp",
      defaultBranch: "master",
      requestedBy: "codex-control",
      tasks: [
        {
          id: "task-1",
          title: "补充 codex smoke 文档",
          pool: "codex",
          allowedPaths: ["docs/**"],
          acceptance: ["新增 smoke 文档"],
          dependsOn: [],
          branchName: "ai/codex/task-1-smoke-doc",
          verification: { mode: "run" },
        },
      ],
      packages: [
        {
          taskId: "task-1",
          assignment: {
            taskId: "task-1",
            workerId: null,
            pool: "codex",
            status: "pending",
            branchName: "ai/codex/task-1-smoke-doc",
            allowedPaths: ["docs/**"],
            commands: {
              test: "echo ok",
            },
            repo: "TingRuDeng/openclaw-multi-agent-mvp",
            defaultBranch: "master",
          },
          workerPrompt: "你是 codex-worker。",
          contextMarkdown: "# Context",
        },
      ],
      createdAt: "2026-03-16T13:00:00.000Z",
    });
    state = dispatch.state;

    expect(dispatch.assignments[0]).toMatchObject({
      workerId: null,
      status: "pending",
    });

    state = mod.registerWorker(state, {
      workerId: "codex-late-joiner",
      pool: "codex",
      hostname: "late-host",
      labels: ["mac", "codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-16T13:01:00.000Z",
    });

    const claimed = mod.claimAssignedTaskForWorker(state, {
      workerId: "codex-late-joiner",
      at: "2026-03-16T13:01:05.000Z",
    });
    state = claimed.state;

    expect(claimed.assignment?.task.id).toBe(dispatch.taskIds[0]);
    expect(claimed.assignment?.assignment.workerId).toBe("codex-late-joiner");

    const snapshot = mod.buildDashboardSnapshot(state, {
      now: "2026-03-16T13:01:06.000Z",
    });
    expect(snapshot.tasks[0]).toMatchObject({
      status: "assigned",
      assignedWorkerId: "codex-late-joiner",
    });
    expect(snapshot.assignments[0]).toMatchObject({
      workerId: "codex-late-joiner",
      status: "assigned",
    });
    expect(snapshot.workers[0]).toMatchObject({
      id: "codex-late-joiner",
      status: "busy",
      currentTaskId: dispatch.taskIds[0],
    });
    expect(snapshot.events.some((event: { payload?: { from?: string; to?: string } }) =>
      event.payload?.from === "ready" && event.payload?.to === "assigned")).toBe(true);
  });

  it("assigns directly to targetWorkerId when that worker is idle", async () => {
    const stateDir = makeTempDir();
    const mod = await import(stateModulePath);

    let state = mod.loadRuntimeState(stateDir);
    state = mod.registerWorker(state, {
      workerId: "trae-remote",
      pool: "trae",
      hostname: "remote",
      labels: ["trae"],
      repoDir: "/repos/forgeflow-remote",
      at: "2026-03-29T10:00:00.000Z",
    });
    state = mod.registerWorker(state, {
      workerId: "trae-local",
      pool: "trae",
      hostname: "local",
      labels: ["trae"],
      repoDir: "/repos/forgeflow-local",
      at: "2026-03-29T10:00:01.000Z",
    });

    const dispatch = mod.createDispatch(state, {
      repo: "TingRuDeng/ForgeFlow",
      defaultBranch: "main",
      requestedBy: "worker-review-orchestrator",
      tasks: [
        {
          id: "task-1",
          title: "Target remote worker",
          pool: "trae",
          allowedPaths: ["scripts/lib/dispatcher-state.js"],
          acceptance: ["pnpm test"],
          dependsOn: [],
          branchName: "ai/trae/target-worker",
          targetWorkerId: "trae-remote",
          verification: { mode: "run" },
        },
      ],
      packages: [
        {
          taskId: "task-1",
          assignment: {
            taskId: "task-1",
            workerId: null,
            pool: "trae",
            status: "pending",
            branchName: "ai/trae/target-worker",
            allowedPaths: ["scripts/lib/dispatcher-state.js"],
            repo: "TingRuDeng/ForgeFlow",
            defaultBranch: "main",
            targetWorkerId: "trae-remote",
          },
          workerPrompt: "Test prompt",
        },
      ],
      createdAt: "2026-03-29T10:00:02.000Z",
    });

    expect(dispatch.assignments[0]).toMatchObject({
      workerId: "trae-remote",
      status: "assigned",
    });
    const task = dispatch.state.tasks.find((item: { id: string }) => item.id === dispatch.taskIds[0]);
    const assignment = dispatch.state.assignments.find((item: { taskId: string }) => item.taskId === dispatch.taskIds[0]);
    expect(task).toMatchObject({
      assignedWorkerId: "trae-remote",
      targetWorkerId: "trae-remote",
      status: "assigned",
    });
    expect(assignment.assignment).toMatchObject({
      targetWorkerId: "trae-remote",
    });
  });

  it("keeps a targetWorkerId task ready when the target worker is unavailable", async () => {
    const stateDir = makeTempDir();
    const mod = await import(stateModulePath);

    let state = mod.loadRuntimeState(stateDir);
    state = mod.registerWorker(state, {
      workerId: "trae-remote",
      pool: "trae",
      hostname: "remote",
      labels: ["trae"],
      repoDir: "/repos/forgeflow-remote",
      at: "2026-03-29T10:00:00.000Z",
    });
    state = {
      ...state,
      workers: state.workers.map((worker: { id: string }) => worker.id === "trae-remote"
        ? { ...worker, status: "busy", currentTaskId: "dispatch-1:task-1" }
        : worker),
    };

    const dispatch = mod.createDispatch(state, {
      repo: "TingRuDeng/ForgeFlow",
      defaultBranch: "main",
      requestedBy: "worker-review-orchestrator",
      tasks: [
        {
          id: "task-1",
          title: "Target remote worker later",
          pool: "trae",
          allowedPaths: ["scripts/lib/dispatcher-state.js"],
          acceptance: ["pnpm test"],
          dependsOn: [],
          branchName: "ai/trae/target-worker-later",
          target_worker_id: "trae-remote",
          verification: { mode: "run" },
        },
      ],
      packages: [
        {
          taskId: "task-1",
          assignment: {
            taskId: "task-1",
            workerId: null,
            pool: "trae",
            status: "pending",
            branchName: "ai/trae/target-worker-later",
            allowedPaths: ["scripts/lib/dispatcher-state.js"],
            repo: "TingRuDeng/ForgeFlow",
            defaultBranch: "main",
          },
          workerPrompt: "Test prompt",
        },
      ],
      createdAt: "2026-03-29T10:00:02.000Z",
    });

    expect(dispatch.assignments[0]).toMatchObject({
      workerId: null,
      status: "pending",
    });
    const task = dispatch.state.tasks.find((item: { id: string }) => item.id === dispatch.taskIds[0]);
    const assignment = dispatch.state.assignments.find((item: { taskId: string }) => item.taskId === dispatch.taskIds[0]);
    expect(task).toMatchObject({
      targetWorkerId: "trae-remote",
      status: "ready",
    });
    expect(task.assignedWorkerId ?? null).toBe(null);
    expect(assignment.assignment).toMatchObject({
      targetWorkerId: "trae-remote",
    });
  });

  it("requeues an assigned task after timeout and lets another worker claim it", async () => {
    const stateDir = makeTempDir();
    const mod = await import(stateModulePath);

    let state = mod.loadRuntimeState(stateDir);
    state = mod.registerWorker(state, {
      workerId: "codex-first",
      pool: "codex",
      hostname: "host-1",
      labels: ["codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-16T16:00:00.000Z",
    });
    state = mod.registerWorker(state, {
      workerId: "codex-second",
      pool: "codex",
      hostname: "host-2",
      labels: ["codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-16T16:01:05.000Z",
    });

    const dispatch = mod.createDispatch(state, {
      repo: "TingRuDeng/openclaw-multi-agent-mvp",
      defaultBranch: "master",
      requestedBy: "codex-control",
      tasks: [
        {
          id: "task-1",
          title: "补充超时回收文档",
          pool: "codex",
          allowedPaths: ["docs/**"],
          acceptance: ["新增超时回收说明"],
          dependsOn: [],
          branchName: "ai/codex/task-1-timeout-doc",
          verification: { mode: "run" },
        },
      ],
      packages: [
        {
          taskId: "task-1",
          assignment: {
            taskId: "task-1",
            workerId: "placeholder",
            pool: "codex",
            status: "assigned",
            branchName: "ai/codex/task-1-timeout-doc",
            allowedPaths: ["docs/**"],
            commands: {
              test: "echo ok",
            },
            repo: "TingRuDeng/openclaw-multi-agent-mvp",
            defaultBranch: "master",
          },
          workerPrompt: "你是 codex-worker。",
          contextMarkdown: "# Context",
        },
      ],
      createdAt: "2026-03-16T16:00:10.000Z",
    });
    state = dispatch.state;

    expect(dispatch.assignments[0]).toMatchObject({
      workerId: "codex-first",
      status: "assigned",
    });

    const firstClaim = mod.claimAssignedTaskForWorker(state, {
      workerId: "codex-first",
      at: "2026-03-16T16:01:20.000Z",
      assignmentTimeoutMs: 30_000,
    });
    state = firstClaim.state;

    expect(firstClaim.assignment).toBeNull();

    const secondClaim = mod.claimAssignedTaskForWorker(state, {
      workerId: "codex-second",
      at: "2026-03-16T16:01:21.000Z",
      assignmentTimeoutMs: 30_000,
    });
    state = secondClaim.state;

    expect(secondClaim.assignment?.task.id).toBe(dispatch.taskIds[0]);
    expect(secondClaim.assignment?.assignment.workerId).toBe("codex-second");

    const snapshot = mod.buildDashboardSnapshot(state, {
      now: "2026-03-16T16:01:22.000Z",
      assignmentTimeoutMs: 30_000,
    });
    expect(snapshot.tasks[0]).toMatchObject({
      status: "assigned",
      assignedWorkerId: "codex-second",
    });
    expect(snapshot.workers.find((worker: { id: string }) => worker.id === "codex-first")).toMatchObject({
      status: "offline",
    });
    expect(snapshot.events.some((event: { type: string; payload?: { from?: string; to?: string } }) =>
      event.type === "status_changed" &&
      event.payload?.from === "assigned" &&
      event.payload?.to === "ready")).toBe(true);
  });

  it("does not requeue a task that already moved to in_progress", async () => {
    const stateDir = makeTempDir();
    const mod = await import(stateModulePath);

    let state = mod.loadRuntimeState(stateDir);
    state = mod.registerWorker(state, {
      workerId: "codex-executor",
      pool: "codex",
      hostname: "executor-host",
      labels: ["codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-16T17:00:00.000Z",
    });

    const dispatch = mod.createDispatch(state, {
      repo: "TingRuDeng/openclaw-multi-agent-mvp",
      defaultBranch: "master",
      requestedBy: "codex-control",
      tasks: [
        {
          id: "task-1",
          title: "补充执行中状态说明",
          pool: "codex",
          allowedPaths: ["docs/**"],
          acceptance: ["新增执行中状态说明"],
          dependsOn: [],
          branchName: "ai/codex/task-1-in-progress-doc",
          verification: { mode: "run" },
        },
      ],
      packages: [
        {
          taskId: "task-1",
          assignment: {
            taskId: "task-1",
            workerId: "placeholder",
            pool: "codex",
            status: "assigned",
            branchName: "ai/codex/task-1-in-progress-doc",
            allowedPaths: ["docs/**"],
            commands: {
              test: "echo ok",
            },
            repo: "TingRuDeng/openclaw-multi-agent-mvp",
            defaultBranch: "master",
          },
          workerPrompt: "你是 codex-worker。",
          contextMarkdown: "# Context",
        },
      ],
      createdAt: "2026-03-16T17:00:10.000Z",
    });
    state = dispatch.state;

    state = mod.beginTaskForWorker(state, {
      workerId: "codex-executor",
      taskId: dispatch.taskIds[0],
      at: "2026-03-16T17:00:15.000Z",
    });

    const snapshot = mod.buildDashboardSnapshot(state, {
      now: "2026-03-16T17:00:25.000Z",
      assignmentTimeoutMs: 30_000,
    });

    expect(snapshot.tasks[0]).toMatchObject({
      status: "in_progress",
      assignedWorkerId: "codex-executor",
    });
    expect(snapshot.workers[0]).toMatchObject({
      id: "codex-executor",
      status: "busy",
      currentTaskId: dispatch.taskIds[0],
    });
  });

  it("heartbeat does not change in_progress worker to idle", async () => {
    const stateDir = makeTempDir();
    const mod = await import(stateModulePath);

    let state = mod.loadRuntimeState(stateDir);
    state = mod.registerWorker(state, {
      workerId: "codex-heartbeat-test",
      pool: "codex",
      hostname: "test-host",
      labels: ["codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-17T10:00:00.000Z",
    });

    state = {
      ...state,
      workers: state.workers.map((worker: { id: string }) => worker.id === "codex-heartbeat-test"
        ? {
            ...worker,
            status: "busy",
            currentTaskId: "dispatch-1:task-1",
          }
        : worker),
    };

    state = mod.heartbeatWorker(state, {
      workerId: "codex-heartbeat-test",
      at: "2026-03-17T10:00:05.000Z",
    });

    const worker = state.workers.find((w: { id: string }) => w.id === "codex-heartbeat-test");
    expect(worker).toMatchObject({
      status: "busy",
      currentTaskId: "dispatch-1:task-1",
    });

    const snapshot = mod.buildDashboardSnapshot(state, {
      now: "2026-03-17T10:00:06.000Z",
    });
    expect(snapshot.workers[0]).toMatchObject({
      id: "codex-heartbeat-test",
      status: "busy",
    });
  });

  it("heartbeat returns idle worker to idle (not busy)", async () => {
    const stateDir = makeTempDir();
    const mod = await import(stateModulePath);

    let state = mod.loadRuntimeState(stateDir);
    state = mod.registerWorker(state, {
      workerId: "codex-idle-worker",
      pool: "codex",
      hostname: "test-host",
      labels: ["codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-17T10:00:00.000Z",
    });

    expect(state.workers[0]).toMatchObject({
      status: "idle",
    });

    state = mod.heartbeatWorker(state, {
      workerId: "codex-idle-worker",
      at: "2026-03-17T10:00:05.000Z",
    });

    const worker = state.workers.find((w: { id: string }) => w.id === "codex-idle-worker");
    expect(worker).toMatchObject({
      status: "idle",
      currentTaskId: undefined,
    });
  });

  it("heartbeat returns offline worker to idle when no task", async () => {
    const stateDir = makeTempDir();
    const mod = await import(stateModulePath);

    let state = mod.loadRuntimeState(stateDir);
    state = mod.registerWorker(state, {
      workerId: "codex-offline-recover",
      pool: "codex",
      hostname: "test-host",
      labels: ["codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-17T10:00:00.000Z",
    });

    state = {
      ...state,
      workers: state.workers.map((worker: { id: string }) => worker.id === "codex-offline-recover"
        ? {
            ...worker,
            status: "offline",
          }
        : worker),
    };

    state = mod.heartbeatWorker(state, {
      workerId: "codex-offline-recover",
      at: "2026-03-17T10:00:35.000Z",
    });

    const worker = state.workers.find((w: { id: string }) => w.id === "codex-offline-recover");
    expect(worker).toMatchObject({
      status: "idle",
    });
  });

  it("submit_result with review_ready returns worker to idle", async () => {
    const stateDir = makeTempDir();
    const mod = await import(stateModulePath);

    let state = mod.loadRuntimeState(stateDir);
    state = mod.registerWorker(state, {
      workerId: "codex-submit-review",
      pool: "codex",
      hostname: "test-host",
      labels: ["codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-17T10:00:00.000Z",
    });

    const dispatch = mod.createDispatch(state, {
      repo: "TingRuDeng/openclaw-multi-agent-mvp",
      defaultBranch: "master",
      requestedBy: "codex-control",
      tasks: [
        {
          id: "task-review",
          title: "Review 测试任务",
          pool: "codex",
          allowedPaths: ["src/**"],
          acceptance: ["完成代码"],
          dependsOn: [],
          branchName: "ai/codex/task-review",
          verification: { mode: "run" },
        },
      ],
      packages: [
        {
          taskId: "task-review",
          assignment: {
            taskId: "task-review",
            workerId: "placeholder",
            pool: "codex",
            status: "assigned",
            branchName: "ai/codex/task-review",
            allowedPaths: ["src/**"],
            commands: {
              test: "pnpm test",
            },
            repo: "TingRuDeng/openclaw-multi-agent-mvp",
            defaultBranch: "master",
          },
          workerPrompt: "你是 codex-worker。",
          contextMarkdown: "# Context",
        },
      ],
      createdAt: "2026-03-17T10:00:10.000Z",
    });
    state = dispatch.state;

    state = mod.beginTaskForWorker(state, {
      workerId: "codex-submit-review",
      taskId: dispatch.taskIds[0],
      at: "2026-03-17T10:00:15.000Z",
    });

    let worker = state.workers.find((w: { id: string }) => w.id === "codex-submit-review");
    expect(worker).toMatchObject({
      status: "busy",
      currentTaskId: dispatch.taskIds[0],
    });

    state = mod.recordWorkerResult(state, {
      workerId: "codex-submit-review",
      result: {
        taskId: dispatch.taskIds[0],
        workerId: "codex-submit-review",
        provider: "codex",
        pool: "codex",
        branchName: "ai/codex/task-review",
        repo: "TingRuDeng/openclaw-multi-agent-mvp",
        defaultBranch: "master",
        mode: "run",
        output: "done",
        generatedAt: "2026-03-17T10:05:00.000Z",
        verification: {
          allPassed: true,
          commands: [
            {
              command: "pnpm test",
              exitCode: 0,
              output: "ok",
            },
          ],
        },
      },
      changedFiles: ["src/main.ts"],
      pullRequest: {
        number: 100,
        url: "https://github.com/TingRuDeng/openclaw-multi-agent-mvp/pull/100",
        headBranch: "ai/codex/task-review",
        baseBranch: "master",
      },
    });

    worker = state.workers.find((w: { id: string }) => w.id === "codex-submit-review");
    expect(worker).toMatchObject({
      status: "idle",
      currentTaskId: undefined,
    });

    const snapshot = mod.buildDashboardSnapshot(state, {
      now: "2026-03-17T10:05:05.000Z",
    });
    expect(snapshot.tasks[0]).toMatchObject({
      status: "review",
    });
    expect(snapshot.assignments[0]).toMatchObject({
      status: "review",
      assignment: {
        status: "review",
      },
    });
    expect(snapshot.workers[0]).toMatchObject({
      id: "codex-submit-review",
      status: "idle",
    });
  });

  it("submit_result with failed returns worker to idle", async () => {
    const stateDir = makeTempDir();
    const mod = await import(stateModulePath);

    let state = mod.loadRuntimeState(stateDir);
    state = mod.registerWorker(state, {
      workerId: "codex-submit-fail",
      pool: "codex",
      hostname: "test-host",
      labels: ["codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-17T10:00:00.000Z",
    });

    const dispatch = mod.createDispatch(state, {
      repo: "TingRuDeng/openclaw-multi-agent-mvp",
      defaultBranch: "master",
      requestedBy: "codex-control",
      tasks: [
        {
          id: "task-fail",
          title: "失败测试任务",
          pool: "codex",
          allowedPaths: ["src/**"],
          acceptance: ["完成代码"],
          dependsOn: [],
          branchName: "ai/codex/task-fail",
          verification: { mode: "run" },
        },
      ],
      packages: [
        {
          taskId: "task-fail",
          assignment: {
            taskId: "task-fail",
            workerId: "placeholder",
            pool: "codex",
            status: "assigned",
            branchName: "ai/codex/task-fail",
            allowedPaths: ["src/**"],
            commands: {
              test: "pnpm test",
            },
            repo: "TingRuDeng/openclaw-multi-agent-mvp",
            defaultBranch: "master",
          },
          workerPrompt: "你是 codex-worker。",
          contextMarkdown: "# Context",
        },
      ],
      createdAt: "2026-03-17T10:00:10.000Z",
    });
    state = dispatch.state;

    state = mod.beginTaskForWorker(state, {
      workerId: "codex-submit-fail",
      taskId: dispatch.taskIds[0],
      at: "2026-03-17T10:00:15.000Z",
    });

    state = mod.recordWorkerResult(state, {
      workerId: "codex-submit-fail",
      result: {
        taskId: dispatch.taskIds[0],
        workerId: "codex-submit-fail",
        provider: "codex",
        pool: "codex",
        branchName: "ai/codex/task-fail",
        repo: "TingRuDeng/openclaw-multi-agent-mvp",
        defaultBranch: "master",
        mode: "run",
        output: "tests failed",
        generatedAt: "2026-03-17T10:05:00.000Z",
        verification: {
          allPassed: false,
          commands: [
            {
              command: "pnpm test",
              exitCode: 1,
              output: "FAIL",
            },
          ],
        },
      },
      changedFiles: [],
      pullRequest: null,
    });

    const worker = state.workers.find((w: { id: string }) => w.id === "codex-submit-fail");
    expect(worker).toMatchObject({
      status: "idle",
      currentTaskId: undefined,
    });

    const snapshot = mod.buildDashboardSnapshot(state, {
      now: "2026-03-17T10:05:05.000Z",
    });
    expect(snapshot.tasks[0]).toMatchObject({
      status: "failed",
    });
    expect(snapshot.assignments[0]).toMatchObject({
      status: "failed",
      assignment: {
        status: "failed",
      },
    });
    expect(snapshot.workers[0]).toMatchObject({
      id: "codex-submit-fail",
      status: "idle",
    });
  });

  it("review decision keeps assignment status aligned with the task", async () => {
    const stateDir = makeTempDir();
    const mod = await import(stateModulePath);

    let state = mod.loadRuntimeState(stateDir);
    state = mod.registerWorker(state, {
      workerId: "codex-review-sync",
      pool: "codex",
      hostname: "test-host",
      labels: ["codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-17T10:00:00.000Z",
    });

    const dispatch = mod.createDispatch(state, {
      repo: "TingRuDeng/openclaw-multi-agent-mvp",
      defaultBranch: "master",
      requestedBy: "codex-control",
      tasks: [
        {
          id: "task-review-sync",
          title: "Review 状态同步测试",
          pool: "codex",
          allowedPaths: ["src/**"],
          acceptance: ["完成代码"],
          dependsOn: [],
          branchName: "ai/codex/task-review-sync",
          verification: { mode: "run" },
        },
      ],
      packages: [
        {
          taskId: "task-review-sync",
          assignment: {
            taskId: "task-review-sync",
            workerId: "placeholder",
            pool: "codex",
            status: "assigned",
            branchName: "ai/codex/task-review-sync",
            allowedPaths: ["src/**"],
            commands: { test: "pnpm test" },
            repo: "TingRuDeng/openclaw-multi-agent-mvp",
            defaultBranch: "master",
          },
          workerPrompt: "你是 codex-worker。",
          contextMarkdown: "# Context",
        },
      ],
      createdAt: "2026-03-17T10:00:10.000Z",
    });
    state = dispatch.state;
    const taskId = dispatch.taskIds[0];

    state = mod.beginTaskForWorker(state, {
      workerId: "codex-review-sync",
      taskId,
      at: "2026-03-17T10:00:15.000Z",
    });

    state = mod.recordWorkerResult(state, {
      workerId: "codex-review-sync",
      result: {
        taskId,
        workerId: "codex-review-sync",
        provider: "codex",
        pool: "codex",
        branchName: "ai/codex/task-review-sync",
        repo: "TingRuDeng/openclaw-multi-agent-mvp",
        defaultBranch: "master",
        mode: "run",
        output: "done",
        generatedAt: "2026-03-17T10:05:00.000Z",
        verification: {
          allPassed: true,
          commands: [{ command: "pnpm test", exitCode: 0, output: "ok" }],
        },
      },
      changedFiles: ["src/main.ts"],
      pullRequest: null,
    });

    state = mod.recordReviewDecision(state, {
      taskId,
      decision: "block",
      actor: "reviewer",
      notes: "needs changes",
      at: "2026-03-17T10:06:00.000Z",
    });

    const snapshot = mod.buildDashboardSnapshot(state, {
      now: "2026-03-17T10:06:05.000Z",
    });
    expect(snapshot.tasks[0]).toMatchObject({
      status: "blocked",
    });
    expect(snapshot.assignments[0]).toMatchObject({
      status: "blocked",
      assignment: {
        status: "blocked",
      },
    });
  });

  it("busy worker becomes offline after heartbeat timeout", async () => {
    const stateDir = makeTempDir();
    const mod = await import(stateModulePath);

    let state = mod.loadRuntimeState(stateDir);
    state = mod.registerWorker(state, {
      workerId: "codex-timeout-worker",
      pool: "codex",
      hostname: "test-host",
      labels: ["codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-17T10:00:00.000Z",
    });

    state = {
      ...state,
      workers: state.workers.map((worker: { id: string }) => worker.id === "codex-timeout-worker"
        ? {
            ...worker,
            status: "busy",
            currentTaskId: "dispatch-1:task-1",
            lastHeartbeatAt: "2026-03-17T10:00:00.000Z",
          }
        : worker),
    };

    const snapshot = mod.buildDashboardSnapshot(state, {
      now: "2026-03-17T10:00:40.000Z",
      heartbeatTimeoutMs: 30_000,
    });

    expect(snapshot.workers[0]).toMatchObject({
      id: "codex-timeout-worker",
      status: "offline",
      currentTaskId: "dispatch-1:task-1",
    });
  });

  it("dashboard snapshot reflects correct busy/idle/offline states", async () => {
    const stateDir = makeTempDir();
    const mod = await import(stateModulePath);

    let state = mod.loadRuntimeState(stateDir);
    state = mod.registerWorker(state, {
      workerId: "codex-busy-1",
      pool: "codex",
      hostname: "host-1",
      labels: ["codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-17T10:00:00.000Z",
    });
    state = mod.registerWorker(state, {
      workerId: "codex-idle-1",
      pool: "codex",
      hostname: "host-2",
      labels: ["codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-17T10:00:05.000Z",
    });
    state = mod.registerWorker(state, {
      workerId: "codex-offline-1",
      pool: "codex",
      hostname: "host-3",
      labels: ["codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-17T10:00:00.000Z",
    });

    state = {
      ...state,
      workers: state.workers.map((worker: { id: string }) => {
        if (worker.id === "codex-busy-1") {
          return { ...worker, status: "busy", currentTaskId: "dispatch-1:task-1" };
        }
        if (worker.id === "codex-offline-1") {
          return { ...worker, status: "offline" };
        }
        return worker;
      }),
    };

    const snapshot = mod.buildDashboardSnapshot(state, {
      now: "2026-03-17T10:00:10.000Z",
      heartbeatTimeoutMs: 30_000,
    });

    expect(snapshot.stats.workers).toMatchObject({
      total: 3,
      idle: 1,
      busy: 1,
      offline: 1,
    });

    const busyWorker = snapshot.workers.find((w: { id: string }) => w.id === "codex-busy-1");
    expect(busyWorker).toMatchObject({
      status: "busy",
      currentTaskId: "dispatch-1:task-1",
    });

    const idleWorker = snapshot.workers.find((w: { id: string }) => w.id === "codex-idle-1");
    expect(idleWorker).toMatchObject({
      status: "idle",
    });

    const offlineWorker = snapshot.workers.find((w: { id: string }) => w.id === "codex-offline-1");
    expect(offlineWorker).toMatchObject({
      status: "offline",
    });
  });

  it("assigns task directly to targetWorkerId when worker is idle and in same pool", async () => {
    const stateDir = makeTempDir();
    const mod = await import(stateModulePath);

    let state = mod.loadRuntimeState(stateDir);
    state = mod.registerWorker(state, {
      workerId: "codex-target",
      pool: "codex",
      hostname: "target-host",
      labels: ["codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-18T10:01:00.000Z",
    });
    state = mod.registerWorker(state, {
      workerId: "codex-other",
      pool: "codex",
      hostname: "other-host",
      labels: ["codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-18T10:01:02.000Z",
    });

    const dispatch = mod.createDispatch(state, {
      repo: "TingRuDeng/openclaw-multi-agent-mvp",
      defaultBranch: "master",
      requestedBy: "codex-control",
      tasks: [
        {
          id: "task-target",
          title: "Targeted task",
          pool: "codex",
          targetWorkerId: "codex-target",
          allowedPaths: ["src/**"],
          acceptance: ["完成代码"],
          dependsOn: [],
          branchName: "ai/codex/task-target",
          verification: { mode: "run" },
        },
      ],
      packages: [
        {
          taskId: "task-target",
          assignment: {
            taskId: "task-target",
            workerId: "placeholder",
            pool: "codex",
            status: "assigned",
            branchName: "ai/codex/task-target",
            allowedPaths: ["src/**"],
            commands: { test: "pnpm test" },
            repo: "TingRuDeng/openclaw-multi-agent-mvp",
            defaultBranch: "master",
          },
          workerPrompt: "你是 codex-worker。",
          contextMarkdown: "# Context",
        },
      ],
      createdAt: "2026-03-18T10:01:03.000Z",
    });
    state = dispatch.state;

    expect(dispatch.assignments[0]).toMatchObject({
      workerId: "codex-target",
      status: "assigned",
    });

    const snapshot = mod.buildDashboardSnapshot(state, {
      now: "2026-03-18T10:01:05.000Z",
    });
    expect(snapshot.tasks[0]).toMatchObject({
      status: "assigned",
      assignedWorkerId: "codex-target",
      targetWorkerId: "codex-target",
    });
    expect(snapshot.workers.find((w: { id: string }) => w.id === "codex-target")).toMatchObject({
      status: "busy",
      currentTaskId: dispatch.taskIds[0],
    });
    expect(snapshot.workers.find((w: { id: string }) => w.id === "codex-other")).toMatchObject({
      status: "idle",
    });
  });

  it("keeps task pending when targetWorkerId is specified but worker is not idle", async () => {
    const stateDir = makeTempDir();
    const mod = await import(stateModulePath);

    let state = mod.loadRuntimeState(stateDir);
    state = mod.registerWorker(state, {
      workerId: "codex-busy-target",
      pool: "codex",
      hostname: "target-host",
      labels: ["codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-18T10:00:00.000Z",
    });
    state = {
      ...state,
      workers: state.workers.map((worker: { id: string }) => worker.id === "codex-busy-target"
        ? { ...worker, status: "busy", currentTaskId: "dispatch-prev:task-1" }
        : worker),
    };

    const dispatch = mod.createDispatch(state, {
      repo: "TingRuDeng/openclaw-multi-agent-mvp",
      defaultBranch: "master",
      requestedBy: "codex-control",
      tasks: [
        {
          id: "task-busy-target",
          title: "Task with busy target",
          pool: "codex",
          targetWorkerId: "codex-busy-target",
          allowedPaths: ["src/**"],
          acceptance: ["完成代码"],
          dependsOn: [],
          branchName: "ai/codex/task-busy-target",
          verification: { mode: "run" },
        },
      ],
      packages: [
        {
          taskId: "task-busy-target",
          assignment: {
            taskId: "task-busy-target",
            workerId: "placeholder",
            pool: "codex",
            status: "assigned",
            branchName: "ai/codex/task-busy-target",
            allowedPaths: ["src/**"],
            commands: { test: "pnpm test" },
            repo: "TingRuDeng/openclaw-multi-agent-mvp",
            defaultBranch: "master",
          },
          workerPrompt: "你是 codex-worker。",
          contextMarkdown: "# Context",
        },
      ],
      createdAt: "2026-03-18T10:01:00.000Z",
    });
    state = dispatch.state;

    expect(dispatch.assignments[0]).toMatchObject({
      workerId: null,
      status: "pending",
    });

    const snapshot = mod.buildDashboardSnapshot(state, {
      now: "2026-03-18T10:01:05.000Z",
    });
    expect(snapshot.tasks[0]).toMatchObject({
      status: "ready",
      assignedWorkerId: null,
      targetWorkerId: "codex-busy-target",
    });
  });

  it("targetWorkerId task cannot be claimed by other workers", async () => {
    const stateDir = makeTempDir();
    const mod = await import(stateModulePath);

    let state = mod.loadRuntimeState(stateDir);
    state = mod.registerWorker(state, {
      workerId: "codex-intended",
      pool: "codex",
      hostname: "intended-host",
      labels: ["codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-18T10:00:00.000Z",
    });
    state = mod.registerWorker(state, {
      workerId: "codex-other-worker",
      pool: "codex",
      hostname: "other-host",
      labels: ["codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-18T10:00:05.000Z",
    });

    const dispatch = mod.createDispatch(state, {
      repo: "TingRuDeng/openclaw-multi-agent-mvp",
      defaultBranch: "master",
      requestedBy: "codex-control",
      tasks: [
        {
          id: "task-reserved",
          title: "Reserved task",
          pool: "codex",
          targetWorkerId: "codex-intended",
          allowedPaths: ["src/**"],
          acceptance: ["完成代码"],
          dependsOn: [],
          branchName: "ai/codex/task-reserved",
          verification: { mode: "run" },
        },
      ],
      packages: [
        {
          taskId: "task-reserved",
          assignment: {
            taskId: "task-reserved",
            workerId: "placeholder",
            pool: "codex",
            status: "assigned",
            branchName: "ai/codex/task-reserved",
            allowedPaths: ["src/**"],
            commands: { test: "pnpm test" },
            repo: "TingRuDeng/openclaw-multi-agent-mvp",
            defaultBranch: "master",
          },
          workerPrompt: "你是 codex-worker。",
          contextMarkdown: "# Context",
        },
      ],
      createdAt: "2026-03-18T10:01:00.000Z",
    });
    state = dispatch.state;

    const otherClaim = mod.claimAssignedTaskForWorker(state, {
      workerId: "codex-other-worker",
      at: "2026-03-18T10:01:10.000Z",
    });
    state = otherClaim.state;

    expect(otherClaim.assignment).toBeNull();

    const intendedClaim = mod.claimAssignedTaskForWorker(state, {
      workerId: "codex-intended",
      at: "2026-03-18T10:01:15.000Z",
    });
    state = intendedClaim.state;

    expect(intendedClaim.assignment?.task.id).toBe(dispatch.taskIds[0]);
    expect(intendedClaim.assignment?.assignment.workerId).toBe("codex-intended");
  });

  it("supports target_worker_id snake_case input", async () => {
    const stateDir = makeTempDir();
    const mod = await import(stateModulePath);

    let state = mod.loadRuntimeState(stateDir);
    state = mod.registerWorker(state, {
      workerId: "codex-snake",
      pool: "gemini",
      hostname: "snake-host",
      labels: ["gemini"],
      repoDir: "/repos/openclaw",
      at: "2026-03-18T11:00:00.000Z",
    });

    const dispatch = mod.createDispatch(state, {
      repo: "TingRuDeng/openclaw-multi-agent-mvp",
      defaultBranch: "master",
      requestedBy: "codex-control",
      tasks: [
        {
          id: "task-snake",
          title: "Snake case task",
          pool: "gemini",
          target_worker_id: "codex-snake",
          allowedPaths: ["src/**"],
          acceptance: ["完成代码"],
          dependsOn: [],
          branchName: "ai/gemini/task-snake",
          verification: { mode: "run" },
        },
      ],
      packages: [
        {
          taskId: "task-snake",
          assignment: {
            taskId: "task-snake",
            workerId: "placeholder",
            pool: "gemini",
            status: "assigned",
            branchName: "ai/gemini/task-snake",
            allowedPaths: ["src/**"],
            commands: { test: "pnpm test" },
            repo: "TingRuDeng/openclaw-multi-agent-mvp",
            defaultBranch: "master",
          },
          workerPrompt: "你是 gemini-worker。",
          contextMarkdown: "# Context",
        },
      ],
      createdAt: "2026-03-18T11:01:00.000Z",
    });
    state = dispatch.state;

    expect(dispatch.assignments[0]).toMatchObject({
      workerId: "codex-snake",
      status: "assigned",
    });

    const snapshot = mod.buildDashboardSnapshot(state, {
      now: "2026-03-18T11:01:05.000Z",
    });
    expect(snapshot.tasks[0]).toMatchObject({
      status: "assigned",
      assignedWorkerId: "codex-snake",
      targetWorkerId: "codex-snake",
    });
  });

  it("saveRuntimeState writes atomically via tmp + rename when using JSON backend", async () => {
    const originalEnv = process.env.RUNTIME_STATE_BACKEND;
    process.env.RUNTIME_STATE_BACKEND = "json";

    const stateDir = makeTempDir();
    const mod = await import(stateModulePath);

    let state = mod.loadRuntimeState(stateDir);
    state = mod.registerWorker(state, {
      workerId: "codex-atomic-test",
      pool: "codex",
      hostname: "test-host",
      labels: ["codex"],
      repoDir: "/repos/test",
      at: "2026-03-31T10:00:00.000Z",
    });

    mod.saveRuntimeState(stateDir, state);

    const filePath = path.join(stateDir, "runtime-state.json");
    const tmpFilePath = `${filePath}.tmp`;
    expect(fs.existsSync(tmpFilePath)).toBe(false);
    expect(fs.existsSync(filePath)).toBe(true);

    const content = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(content.workers).toHaveLength(1);
    expect(content.workers[0].id).toBe("codex-atomic-test");

    const reloaded = mod.loadRuntimeState(stateDir);
    expect(reloaded.workers[0].id).toBe("codex-atomic-test");

    if (originalEnv !== undefined) {
      process.env.RUNTIME_STATE_BACKEND = originalEnv;
    } else {
      delete process.env.RUNTIME_STATE_BACKEND;
    }
  });

  it("live bridge exports all required functions", async () => {
    const mod = await import(stateModulePath);

    expect(typeof mod.createEmptyRuntimeState).toBe("function");
    expect(typeof mod.loadRuntimeState).toBe("function");
    expect(typeof mod.saveRuntimeState).toBe("function");
    expect(typeof mod.reconcileRuntimeState).toBe("function");
    expect(typeof mod.registerWorker).toBe("function");
    expect(typeof mod.heartbeatWorker).toBe("function");
    expect(typeof mod.createDispatch).toBe("function");
    expect(typeof mod.getAssignedTaskForWorker).toBe("function");
    expect(typeof mod.claimAssignedTaskForWorker).toBe("function");
    expect(typeof mod.beginTaskForWorker).toBe("function");
    expect(typeof mod.recordWorkerResult).toBe("function");
    expect(typeof mod.recordReviewDecision).toBe("function");
    expect(typeof mod.buildDashboardSnapshot).toBe("function");
  });

  it("supports chatMode field in task and assignment", async () => {
    const stateDir = makeTempDir();
    const mod = await import(stateModulePath);

    let state = mod.loadRuntimeState(stateDir);
    state = mod.registerWorker(state, {
      workerId: "codex-chatmode-test",
      pool: "codex",
      hostname: "test-host",
      labels: ["codex"],
      repoDir: "/repos/test",
      at: "2026-04-01T10:00:00.000Z",
    });

    const dispatch = mod.createDispatch(state, {
      repo: "TingRuDeng/ForgeFlow",
      defaultBranch: "main",
      requestedBy: "test",
      tasks: [
        {
          id: "task-chatmode",
          title: "ChatMode test task",
          pool: "codex",
          allowedPaths: ["src/**"],
          acceptance: ["test"],
          dependsOn: [],
          branchName: "ai/codex/task-chatmode",
          verification: { mode: "run" },
        },
      ],
      packages: [
        {
          taskId: "task-chatmode",
          assignment: {
            taskId: "task-chatmode",
            workerId: "placeholder",
            pool: "codex",
            status: "assigned",
            branchName: "ai/codex/task-chatmode",
            allowedPaths: ["src/**"],
            repo: "TingRuDeng/ForgeFlow",
            defaultBranch: "main",
          },
          workerPrompt: "Test prompt",
        },
      ],
      createdAt: "2026-04-01T10:00:10.000Z",
    });
    state = dispatch.state;

    const task = state.tasks.find((t: { id: string }) => t.id === dispatch.taskIds[0]);
    expect(task.chatMode).toBe("new_chat");

    const assignment = state.assignments.find((a: { taskId: string }) => a.taskId === dispatch.taskIds[0]);
    expect(assignment.assignment.chatMode).toBe("new_chat");

    const assignedTask = mod.getAssignedTaskForWorker(state, "codex-chatmode-test");
    expect(assignedTask.chatMode).toBe("new_chat");
  });

  it("createEmptyRuntimeState returns valid initial state", async () => {
    const mod = await import(stateModulePath);
    const state = mod.createEmptyRuntimeState();

    expect(state).toMatchObject({
      version: 1,
      sequence: 0,
      workers: [],
      tasks: [],
      events: [],
      assignments: [],
      reviews: [],
      pullRequests: [],
      dispatches: [],
    });
    expect(state.updatedAt).toBeDefined();
  });

  it("rebuilds dist even when stale dist already exists", async () => {
    const distPath = path.join(repoRoot, "apps", "dispatcher", "dist", "modules", "server", "runtime-state.js");

    if (fs.existsSync(distPath)) {
      const originalContent = fs.readFileSync(distPath, "utf8");
      const staleContent = originalContent.replace(/chatMode/g, "staleChatMode");
      fs.writeFileSync(distPath, staleContent);
    }

    const mod = await import(stateModulePath);

    const stateDir = makeTempDir();
    let state = mod.loadRuntimeState(stateDir);
    state = mod.registerWorker(state, {
      workerId: "codex-stale-dist-test",
      pool: "codex",
      hostname: "test-host",
      labels: ["codex"],
      repoDir: "/repos/test",
      at: "2026-04-01T11:00:00.000Z",
    });

    const dispatch = mod.createDispatch(state, {
      repo: "TingRuDeng/ForgeFlow",
      defaultBranch: "main",
      requestedBy: "test",
      tasks: [
        {
          id: "task-stale-dist",
          title: "Stale dist test task",
          pool: "codex",
          allowedPaths: ["src/**"],
          acceptance: ["test"],
          dependsOn: [],
          branchName: "ai/codex/task-stale-dist",
          verification: { mode: "run" },
        },
      ],
      packages: [
        {
          taskId: "task-stale-dist",
          assignment: {
            taskId: "task-stale-dist",
            workerId: "placeholder",
            pool: "codex",
            status: "assigned",
            branchName: "ai/codex/task-stale-dist",
            allowedPaths: ["src/**"],
            repo: "TingRuDeng/ForgeFlow",
            defaultBranch: "main",
          },
          workerPrompt: "Test prompt",
        },
      ],
      createdAt: "2026-04-01T11:00:10.000Z",
    });
    state = dispatch.state;

    const task = state.tasks.find((t: { id: string }) => t.id === dispatch.taskIds[0]);
    expect(task.chatMode).toBe("new_chat");

    const assignment = state.assignments.find((a: { taskId: string }) => a.taskId === dispatch.taskIds[0]);
    expect(assignment.assignment.chatMode).toBe("new_chat");
  });
});
