import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type {
  Assignment,
  RuntimeState,
  Task,
  Worker,
} from "../../../src/modules/server/runtime-state.js";

import {
  beginTaskForWorker,
  buildDashboardSnapshot,
  claimAssignedTaskForWorker,
  createDispatch,
  createEmptyRuntimeState,
  disableWorker,
  enableWorker,
  getAssignedTaskForWorker,
  heartbeatWorker,
  loadRuntimeState,
  recordReviewDecision,
  recordWorkerResult,
  registerWorker,
  saveRuntimeState,
} from "../../../src/modules/server/runtime-state.js";

const tempRoots: string[] = [];

function makeTempDir(): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-dispatcher-state-ts-"));
  tempRoots.push(tempDir);
  return tempDir;
}

afterEach(() => {
  for (const tempDir of tempRoots.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("dispatcher runtime state (TypeScript)", () => {
  it("records new runtime timestamps with explicit local offsets instead of UTC z", () => {
    let state = createEmptyRuntimeState();

    expect(state.updatedAt).toMatch(/[+-]\d{2}:\d{2}$/);
    expect(state.updatedAt.endsWith("Z")).toBe(false);

    state = registerWorker(state, {
      workerId: "codex-local-time",
      pool: "codex",
      hostname: "mac-mini",
      labels: ["mac", "codex"],
      repoDir: "/repos/openclaw",
    });

    expect(state.workers[0]?.lastHeartbeatAt).toMatch(/[+-]\d{2}:\d{2}$/);
    expect(state.workers[0]?.lastHeartbeatAt.endsWith("Z")).toBe(false);

    const dispatch = createDispatch(state, {
      repo: "TingRuDeng/openclaw-multi-agent-mvp",
      defaultBranch: "main",
      requestedBy: "codex-control",
      tasks: [
        {
          id: "task-local-time",
          title: "记录本地时区时间",
          pool: "codex",
          branchName: "codex/task-local-time",
          verification: { mode: "run" },
        },
      ],
      packages: [
        {
          taskId: "task-local-time",
          assignment: {
            taskId: "task-local-time",
            workerId: "placeholder",
            pool: "codex",
            status: "assigned",
            branchName: "codex/task-local-time",
            repo: "TingRuDeng/openclaw-multi-agent-mvp",
            defaultBranch: "main",
          },
        },
      ],
    });

    const task = dispatch.state.tasks[0];
    const createdEvent = dispatch.state.events.find((event) => event.type === "created");

    expect(task?.createdAt).toMatch(/[+-]\d{2}:\d{2}$/);
    expect(task?.createdAt.endsWith("Z")).toBe(false);
    expect(createdEvent?.at).toMatch(/[+-]\d{2}:\d{2}$/);
    expect(createdEvent?.at.endsWith("Z")).toBe(false);
    expect(dispatch.state.updatedAt).toMatch(/[+-]\d{2}:\d{2}$/);
    expect(dispatch.state.updatedAt.endsWith("Z")).toBe(false);
  });

  it("orders mixed UTC and local-offset ready tasks by actual time instead of lexical order", () => {
    let state = createEmptyRuntimeState();

    state = createDispatch(state, {
      repo: "TingRuDeng/openclaw-multi-agent-mvp",
      defaultBranch: "main",
      requestedBy: "codex-control",
      tasks: [
        {
          id: "task-utc-created",
          title: "UTC task",
          pool: "codex",
          branchName: "codex/task-utc-created",
          verification: { mode: "run" },
        },
      ],
      packages: [
        {
          taskId: "task-utc-created",
          assignment: {
            taskId: "task-utc-created",
            workerId: null,
            pool: "codex",
            status: "pending",
            branchName: "codex/task-utc-created",
            repo: "TingRuDeng/openclaw-multi-agent-mvp",
            defaultBranch: "main",
          },
        },
      ],
      createdAt: "2026-04-04T00:30:00Z",
    }).state;

    state = createDispatch(state, {
      repo: "TingRuDeng/openclaw-multi-agent-mvp",
      defaultBranch: "main",
      requestedBy: "codex-control",
      tasks: [
        {
          id: "task-local-created",
          title: "Local offset task",
          pool: "codex",
          branchName: "codex/task-local-created",
          verification: { mode: "run" },
        },
      ],
      packages: [
        {
          taskId: "task-local-created",
          assignment: {
            taskId: "task-local-created",
            workerId: null,
            pool: "codex",
            status: "pending",
            branchName: "codex/task-local-created",
            repo: "TingRuDeng/openclaw-multi-agent-mvp",
            defaultBranch: "main",
          },
        },
      ],
      createdAt: "2026-04-04T08:00:00+08:00",
    }).state;

    state = registerWorker(state, {
      workerId: "codex-claim-worker",
      pool: "codex",
      hostname: "mac-mini",
      labels: ["mac", "codex"],
      repoDir: "/repos/openclaw",
      at: "2026-04-04T09:00:00+08:00",
    });

    const claimed = claimAssignedTaskForWorker(state, {
      workerId: "codex-claim-worker",
      at: "2026-04-04T09:00:05+08:00",
    });

    expect(claimed.assignment?.task.id).toBe("dispatch-2:task-local-created");
  });

  it("registers workers, dispatches tasks, processes results, and records review decisions", () => {
    const stateDir = makeTempDir();

    let state = loadRuntimeState(stateDir);
    state = registerWorker(state, {
      workerId: "codex-mac-mini",
      pool: "codex",
      hostname: "mac-mini",
      labels: ["mac", "codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-16T10:00:40.000Z",
    });
    state = registerWorker(state, {
      workerId: "gemini-mbp",
      pool: "gemini",
      hostname: "mbp",
      labels: ["mac", "gemini"],
      repoDir: "/repos/openclaw",
      at: "2026-03-16T10:00:45.000Z",
    });

    const dispatch = createDispatch(state, {
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

    const assignedTask = getAssignedTaskForWorker(state, "codex-mac-mini");
    expect(assignedTask?.assignment.taskId).toBe(dispatch.taskIds[0]);
    expect(assignedTask?.assignment.workerId).toBe("codex-mac-mini");

    state = recordWorkerResult(state, {
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

    const snapshotBeforeDecision = buildDashboardSnapshot(state, {
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

    state = recordReviewDecision(state, {
      taskId: dispatch.taskIds[0],
      actor: "codex-control",
      decision: "merge",
      notes: "self test and PR review passed",
      at: "2026-03-16T10:03:00.000Z",
    });

    saveRuntimeState(stateDir, state);
    const reloaded = loadRuntimeState(stateDir);
    const snapshot = buildDashboardSnapshot(reloaded, {
      now: "2026-03-16T10:03:05.000Z",
    });

    expect(snapshot.tasks[0]).toMatchObject({
      status: "merged",
    });
    expect(snapshot.reviews[0]).toMatchObject({
      decision: "merge",
      actor: "codex-control",
    });
    expect(snapshot.events.some((event) => event.payload && typeof event.payload === "object" && "to" in event.payload && event.payload.to === "merged")).toBe(true);
  });

  it("marks stale workers as offline in dashboard snapshots", () => {
    const stateDir = makeTempDir();

    let state = loadRuntimeState(stateDir);
    state = registerWorker(state, {
      workerId: "codex-stale",
      pool: "codex",
      hostname: "old-host",
      labels: ["codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-16T12:00:00.000Z",
    });
    state = registerWorker(state, {
      workerId: "codex-fresh",
      pool: "codex",
      hostname: "new-host",
      labels: ["codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-16T12:00:50.000Z",
    });

    const snapshot = buildDashboardSnapshot(state, {
      now: "2026-03-16T12:01:00.000Z",
      heartbeatTimeoutMs: 30_000,
    });

    expect(snapshot.workers.find((worker) => worker.id === "codex-stale")).toMatchObject({
      status: "offline",
    });
    expect(snapshot.workers.find((worker) => worker.id === "codex-fresh")).toMatchObject({
      status: "idle",
    });
    expect(snapshot.stats.workers).toMatchObject({
      total: 2,
      idle: 1,
      busy: 0,
      offline: 1,
    });
  });

  it("marks stale busy workers as offline in dashboard snapshots", () => {
    const stateDir = makeTempDir();

    let state = loadRuntimeState(stateDir);
    state = registerWorker(state, {
      workerId: "codex-busy-stale",
      pool: "codex",
      hostname: "old-host",
      labels: ["codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-16T12:00:00.000Z",
    });
    state = {
      ...state,
      workers: state.workers.map((worker) => worker.id === "codex-busy-stale"
        ? {
            ...worker,
            status: "busy",
            currentTaskId: "dispatch-1:task-1",
          }
        : worker),
    };

    const snapshot = buildDashboardSnapshot(state, {
      now: "2026-03-16T12:01:00.000Z",
      heartbeatTimeoutMs: 30_000,
    });

    expect(snapshot.workers.find((worker) => worker.id === "codex-busy-stale")).toMatchObject({
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

  it("reclaims assignments from stale workers before a healthy worker claims them", () => {
    const stateDir = makeTempDir();

    let state = loadRuntimeState(stateDir);
    state = registerWorker(state, {
      workerId: "codex-stale-worker",
      pool: "codex",
      hostname: "old-host",
      labels: ["codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-16T12:00:00.000Z",
    });

    const dispatch = createDispatch(state, {
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

    state = registerWorker(state, {
      workerId: "codex-fresh-worker",
      pool: "codex",
      hostname: "new-host",
      labels: ["codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-16T12:01:00.000Z",
    });

    const claimed = claimAssignedTaskForWorker(state, {
      workerId: "codex-fresh-worker",
      at: "2026-03-16T12:01:01.000Z",
      heartbeatTimeoutMs: 30_000,
    });
    state = claimed.state;

    expect(claimed.assignment?.task.id).toBe(dispatch.taskIds[0]);
    expect(claimed.assignment?.assignment.workerId).toBe("codex-fresh-worker");

    const snapshot = buildDashboardSnapshot(state, {
      now: "2026-03-16T12:01:02.000Z",
      heartbeatTimeoutMs: 30_000,
    });
    expect(snapshot.tasks[0]).toMatchObject({
      status: "assigned",
      assignedWorkerId: "codex-fresh-worker",
    });
    expect(snapshot.workers.find((worker) => worker.id === "codex-stale-worker")).toMatchObject({
      status: "offline",
    });
    expect(snapshot.workers.find((worker) => worker.id === "codex-stale-worker")).not.toHaveProperty("currentTaskId");
    expect(snapshot.workers.find((worker) => worker.id === "codex-fresh-worker")).toMatchObject({
      status: "busy",
      currentTaskId: dispatch.taskIds[0],
    });
    expect(snapshot.events.some((event) =>
      event.type === "status_changed" &&
      event.payload && typeof event.payload === "object" &&
      "from" in event.payload && "to" in event.payload &&
      event.payload.from === "assigned" && event.payload.to === "ready")).toBe(true);
  });

  it("claims a ready task for a worker that registers after dispatch creation", () => {
    const stateDir = makeTempDir();

    let state = loadRuntimeState(stateDir);
    const dispatch = createDispatch(state, {
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

    state = registerWorker(state, {
      workerId: "codex-late-joiner",
      pool: "codex",
      hostname: "late-host",
      labels: ["mac", "codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-16T13:01:00.000Z",
    });

    const claimed = claimAssignedTaskForWorker(state, {
      workerId: "codex-late-joiner",
      at: "2026-03-16T13:01:05.000Z",
    });
    state = claimed.state;

    expect(claimed.assignment?.task.id).toBe(dispatch.taskIds[0]);
    expect(claimed.assignment?.assignment.workerId).toBe("codex-late-joiner");

    const snapshot = buildDashboardSnapshot(state, {
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
    expect(snapshot.events.some((event) =>
      event.payload && typeof event.payload === "object" &&
      "from" in event.payload && "to" in event.payload &&
      event.payload.from === "ready" && event.payload.to === "assigned")).toBe(true);
  });

  it("assigns directly to targetWorkerId when that worker is idle", () => {
    const stateDir = makeTempDir();

    let state = loadRuntimeState(stateDir);
    state = registerWorker(state, {
      workerId: "trae-remote",
      pool: "trae",
      hostname: "remote",
      labels: ["trae"],
      repoDir: "/repos/forgeflow-remote",
      at: "2026-03-29T10:00:00.000Z",
    });
    state = registerWorker(state, {
      workerId: "trae-local",
      pool: "trae",
      hostname: "local",
      labels: ["trae"],
      repoDir: "/repos/forgeflow-local",
      at: "2026-03-29T10:00:01.000Z",
    });

    const dispatch = createDispatch(state, {
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
    const task = dispatch.state.tasks.find((item) => item.id === dispatch.taskIds[0]);
    const assignment = dispatch.state.assignments.find((item) => item.taskId === dispatch.taskIds[0]);
    expect(task).toMatchObject({
      assignedWorkerId: "trae-remote",
      targetWorkerId: "trae-remote",
      status: "assigned",
    });
    expect(assignment?.assignment).toMatchObject({
      targetWorkerId: "trae-remote",
    });
  });

  it("keeps a targetWorkerId task ready when the target worker is unavailable", () => {
    const stateDir = makeTempDir();

    let state = loadRuntimeState(stateDir);
    state = registerWorker(state, {
      workerId: "trae-remote",
      pool: "trae",
      hostname: "remote",
      labels: ["trae"],
      repoDir: "/repos/forgeflow-remote",
      at: "2026-03-29T10:00:00.000Z",
    });
    state = {
      ...state,
      workers: state.workers.map((worker) => worker.id === "trae-remote"
        ? { ...worker, status: "busy", currentTaskId: "dispatch-1:task-1" }
        : worker),
    };

    const dispatch = createDispatch(state, {
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
    const task = dispatch.state.tasks.find((item) => item.id === dispatch.taskIds[0]);
    const assignment = dispatch.state.assignments.find((item) => item.taskId === dispatch.taskIds[0]);
    expect(task).toMatchObject({
      targetWorkerId: "trae-remote",
      status: "ready",
    });
    expect(task?.assignedWorkerId ?? null).toBe(null);
    expect(assignment?.assignment).toMatchObject({
      targetWorkerId: "trae-remote",
    });
  });

  it("requeues an assigned task after timeout and lets another worker claim it", () => {
    const stateDir = makeTempDir();

    let state = loadRuntimeState(stateDir);
    state = registerWorker(state, {
      workerId: "codex-first",
      pool: "codex",
      hostname: "host-1",
      labels: ["codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-16T16:00:00.000Z",
    });
    state = registerWorker(state, {
      workerId: "codex-second",
      pool: "codex",
      hostname: "host-2",
      labels: ["codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-16T16:01:05.000Z",
    });

    const dispatch = createDispatch(state, {
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

    const firstClaim = claimAssignedTaskForWorker(state, {
      workerId: "codex-first",
      at: "2026-03-16T16:01:20.000Z",
      assignmentTimeoutMs: 30_000,
    });
    state = firstClaim.state;

    expect(firstClaim.assignment).toBeNull();

    const secondClaim = claimAssignedTaskForWorker(state, {
      workerId: "codex-second",
      at: "2026-03-16T16:01:21.000Z",
      assignmentTimeoutMs: 30_000,
    });
    state = secondClaim.state;

    expect(secondClaim.assignment?.task.id).toBe(dispatch.taskIds[0]);
    expect(secondClaim.assignment?.assignment.workerId).toBe("codex-second");

    const snapshot = buildDashboardSnapshot(state, {
      now: "2026-03-16T16:01:22.000Z",
      assignmentTimeoutMs: 30_000,
    });
    expect(snapshot.tasks[0]).toMatchObject({
      status: "assigned",
      assignedWorkerId: "codex-second",
    });
    expect(snapshot.workers.find((worker) => worker.id === "codex-first")).toMatchObject({
      status: "offline",
    });
    expect(snapshot.events.some((event) =>
      event.type === "status_changed" &&
      event.payload && typeof event.payload === "object" &&
      "from" in event.payload && "to" in event.payload &&
      event.payload.from === "assigned" && event.payload.to === "ready")).toBe(true);
  });

  it("does not requeue a task that already moved to in_progress", () => {
    const stateDir = makeTempDir();

    let state = loadRuntimeState(stateDir);
    state = registerWorker(state, {
      workerId: "codex-executor",
      pool: "codex",
      hostname: "executor-host",
      labels: ["codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-16T17:00:00.000Z",
    });

    const dispatch = createDispatch(state, {
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

    state = beginTaskForWorker(state, {
      workerId: "codex-executor",
      taskId: dispatch.taskIds[0],
      at: "2026-03-16T17:00:15.000Z",
    });

    const snapshot = buildDashboardSnapshot(state, {
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

  it("heartbeat does not change in_progress worker to idle", () => {
    const stateDir = makeTempDir();

    let state = loadRuntimeState(stateDir);
    state = registerWorker(state, {
      workerId: "codex-heartbeat-test",
      pool: "codex",
      hostname: "test-host",
      labels: ["codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-17T10:00:00.000Z",
    });

    state = {
      ...state,
      workers: state.workers.map((worker) => worker.id === "codex-heartbeat-test"
        ? {
            ...worker,
            status: "busy",
            currentTaskId: "dispatch-1:task-1",
          }
        : worker),
    };

    state = heartbeatWorker(state, {
      workerId: "codex-heartbeat-test",
      at: "2026-03-17T10:00:05.000Z",
    });

    const worker = state.workers.find((w) => w.id === "codex-heartbeat-test");
    expect(worker).toMatchObject({
      status: "busy",
      currentTaskId: "dispatch-1:task-1",
    });

    const snapshot = buildDashboardSnapshot(state, {
      now: "2026-03-17T10:00:06.000Z",
    });
    expect(snapshot.workers[0]).toMatchObject({
      id: "codex-heartbeat-test",
      status: "busy",
    });
  });

  it("heartbeat returns idle worker to idle (not busy)", () => {
    const stateDir = makeTempDir();

    let state = loadRuntimeState(stateDir);
    state = registerWorker(state, {
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

    state = heartbeatWorker(state, {
      workerId: "codex-idle-worker",
      at: "2026-03-17T10:00:05.000Z",
    });

    const worker = state.workers.find((w) => w.id === "codex-idle-worker");
    expect(worker).toMatchObject({
      status: "idle",
      currentTaskId: undefined,
    });
  });

  it("heartbeat returns offline worker to idle when no task", () => {
    const stateDir = makeTempDir();

    let state = loadRuntimeState(stateDir);
    state = registerWorker(state, {
      workerId: "codex-offline-recover",
      pool: "codex",
      hostname: "test-host",
      labels: ["codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-17T10:00:00.000Z",
    });

    state = {
      ...state,
      workers: state.workers.map((worker) => worker.id === "codex-offline-recover"
        ? {
            ...worker,
            status: "offline",
          }
        : worker),
    };

    state = heartbeatWorker(state, {
      workerId: "codex-offline-recover",
      at: "2026-03-17T10:00:35.000Z",
    });

    const worker = state.workers.find((w) => w.id === "codex-offline-recover");
    expect(worker).toMatchObject({
      status: "idle",
    });
  });

  it("submit_result with review_ready returns worker to idle", () => {
    const stateDir = makeTempDir();

    let state = loadRuntimeState(stateDir);
    state = registerWorker(state, {
      workerId: "codex-submit-review",
      pool: "codex",
      hostname: "test-host",
      labels: ["codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-17T10:00:00.000Z",
    });

    const dispatch = createDispatch(state, {
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

    state = beginTaskForWorker(state, {
      workerId: "codex-submit-review",
      taskId: dispatch.taskIds[0],
      at: "2026-03-17T10:00:15.000Z",
    });

    let worker = state.workers.find((w) => w.id === "codex-submit-review");
    expect(worker).toMatchObject({
      status: "busy",
      currentTaskId: dispatch.taskIds[0],
    });

    state = recordWorkerResult(state, {
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

    worker = state.workers.find((w) => w.id === "codex-submit-review");
    expect(worker).toMatchObject({
      status: "idle",
      currentTaskId: undefined,
    });

    const snapshot = buildDashboardSnapshot(state, {
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

  it("submit_result with failed returns worker to idle", () => {
    const stateDir = makeTempDir();

    let state = loadRuntimeState(stateDir);
    state = registerWorker(state, {
      workerId: "codex-submit-fail",
      pool: "codex",
      hostname: "test-host",
      labels: ["codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-17T10:00:00.000Z",
    });

    const dispatch = createDispatch(state, {
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

    state = beginTaskForWorker(state, {
      workerId: "codex-submit-fail",
      taskId: dispatch.taskIds[0],
      at: "2026-03-17T10:00:15.000Z",
    });

    state = recordWorkerResult(state, {
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

    const worker = state.workers.find((w) => w.id === "codex-submit-fail");
    expect(worker).toMatchObject({
      status: "idle",
      currentTaskId: undefined,
    });

    const snapshot = buildDashboardSnapshot(state, {
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

  it("review decision keeps assignment status aligned with the task", () => {
    const stateDir = makeTempDir();

    let state = loadRuntimeState(stateDir);
    state = registerWorker(state, {
      workerId: "codex-review-sync",
      pool: "codex",
      hostname: "test-host",
      labels: ["codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-17T10:00:00.000Z",
    });

    const dispatch = createDispatch(state, {
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

    state = beginTaskForWorker(state, {
      workerId: "codex-review-sync",
      taskId,
      at: "2026-03-17T10:00:15.000Z",
    });

    state = recordWorkerResult(state, {
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

    state = recordReviewDecision(state, {
      taskId,
      decision: "block",
      actor: "reviewer",
      notes: "needs changes",
      at: "2026-03-17T10:06:00.000Z",
    });

    const snapshot = buildDashboardSnapshot(state, {
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

  it("busy worker becomes offline after heartbeat timeout", () => {
    const stateDir = makeTempDir();

    let state = loadRuntimeState(stateDir);
    state = registerWorker(state, {
      workerId: "codex-timeout-worker",
      pool: "codex",
      hostname: "test-host",
      labels: ["codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-17T10:00:00.000Z",
    });

    state = {
      ...state,
      workers: state.workers.map((worker) => worker.id === "codex-timeout-worker"
        ? {
            ...worker,
            status: "busy",
            currentTaskId: "dispatch-1:task-1",
            lastHeartbeatAt: "2026-03-17T10:00:00.000Z",
          }
        : worker),
    };

    const snapshot = buildDashboardSnapshot(state, {
      now: "2026-03-17T10:00:40.000Z",
      heartbeatTimeoutMs: 30_000,
    });

    expect(snapshot.workers[0]).toMatchObject({
      id: "codex-timeout-worker",
      status: "offline",
      currentTaskId: "dispatch-1:task-1",
    });
  });

  it("dashboard snapshot reflects correct busy/idle/offline states", () => {
    const stateDir = makeTempDir();

    let state = loadRuntimeState(stateDir);
    state = registerWorker(state, {
      workerId: "codex-busy-1",
      pool: "codex",
      hostname: "host-1",
      labels: ["codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-17T10:00:00.000Z",
    });
    state = registerWorker(state, {
      workerId: "codex-idle-1",
      pool: "codex",
      hostname: "host-2",
      labels: ["codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-17T10:00:05.000Z",
    });
    state = registerWorker(state, {
      workerId: "codex-offline-1",
      pool: "codex",
      hostname: "host-3",
      labels: ["codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-17T10:00:00.000Z",
    });

    state = {
      ...state,
      workers: state.workers.map((worker) => {
        if (worker.id === "codex-busy-1") {
          return { ...worker, status: "busy", currentTaskId: "dispatch-1:task-1" };
        }
        if (worker.id === "codex-offline-1") {
          return { ...worker, status: "offline" };
        }
        return worker;
      }),
    };

    const snapshot = buildDashboardSnapshot(state, {
      now: "2026-03-17T10:00:10.000Z",
      heartbeatTimeoutMs: 30_000,
    });

    expect(snapshot.stats.workers).toMatchObject({
      total: 3,
      idle: 1,
      busy: 1,
      offline: 1,
    });

    const busyWorker = snapshot.workers.find((w) => w.id === "codex-busy-1");
    expect(busyWorker).toMatchObject({
      status: "busy",
      currentTaskId: "dispatch-1:task-1",
    });

    const idleWorker = snapshot.workers.find((w) => w.id === "codex-idle-1");
    expect(idleWorker).toMatchObject({
      status: "idle",
    });

    const offlineWorker = snapshot.workers.find((w) => w.id === "codex-offline-1");
    expect(offlineWorker).toMatchObject({
      status: "offline",
    });
  });

  it("assigns task directly to targetWorkerId when worker is idle and in same pool", () => {
    const stateDir = makeTempDir();

    let state = loadRuntimeState(stateDir);
    state = registerWorker(state, {
      workerId: "codex-target",
      pool: "codex",
      hostname: "target-host",
      labels: ["codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-18T10:01:00.000Z",
    });
    state = registerWorker(state, {
      workerId: "codex-other",
      pool: "codex",
      hostname: "other-host",
      labels: ["codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-18T10:01:02.000Z",
    });

    const dispatch = createDispatch(state, {
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

    const snapshot = buildDashboardSnapshot(state, {
      now: "2026-03-18T10:01:05.000Z",
    });
    expect(snapshot.tasks[0]).toMatchObject({
      status: "assigned",
      assignedWorkerId: "codex-target",
      targetWorkerId: "codex-target",
    });
    expect(snapshot.workers.find((w) => w.id === "codex-target")).toMatchObject({
      status: "busy",
      currentTaskId: dispatch.taskIds[0],
    });
    expect(snapshot.workers.find((w) => w.id === "codex-other")).toMatchObject({
      status: "idle",
    });
  });

  it("keeps task pending when targetWorkerId is specified but worker is not idle", () => {
    const stateDir = makeTempDir();

    let state = loadRuntimeState(stateDir);
    state = registerWorker(state, {
      workerId: "codex-busy-target",
      pool: "codex",
      hostname: "target-host",
      labels: ["codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-18T10:00:00.000Z",
    });
    state = {
      ...state,
      workers: state.workers.map((worker) => worker.id === "codex-busy-target"
        ? { ...worker, status: "busy", currentTaskId: "dispatch-prev:task-1" }
        : worker),
    };

    const dispatch = createDispatch(state, {
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

    const snapshot = buildDashboardSnapshot(state, {
      now: "2026-03-18T10:01:05.000Z",
    });
    expect(snapshot.tasks[0]).toMatchObject({
      status: "ready",
      assignedWorkerId: null,
      targetWorkerId: "codex-busy-target",
    });
  });

  it("targetWorkerId task cannot be claimed by other workers", () => {
    const stateDir = makeTempDir();

    let state = loadRuntimeState(stateDir);
    state = registerWorker(state, {
      workerId: "codex-intended",
      pool: "codex",
      hostname: "intended-host",
      labels: ["codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-18T10:00:00.000Z",
    });
    state = registerWorker(state, {
      workerId: "codex-other-worker",
      pool: "codex",
      hostname: "other-host",
      labels: ["codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-18T10:00:05.000Z",
    });

    const dispatch = createDispatch(state, {
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

    const otherClaim = claimAssignedTaskForWorker(state, {
      workerId: "codex-other-worker",
      at: "2026-03-18T10:01:10.000Z",
    });
    state = otherClaim.state;

    expect(otherClaim.assignment).toBeNull();

    const intendedClaim = claimAssignedTaskForWorker(state, {
      workerId: "codex-intended",
      at: "2026-03-18T10:01:15.000Z",
    });
    state = intendedClaim.state;

    expect(intendedClaim.assignment?.task.id).toBe(dispatch.taskIds[0]);
    expect(intendedClaim.assignment?.assignment.workerId).toBe("codex-intended");
  });

  it("supports target_worker_id snake_case input", () => {
    const stateDir = makeTempDir();

    let state = loadRuntimeState(stateDir);
    state = registerWorker(state, {
      workerId: "codex-snake",
      pool: "gemini",
      hostname: "snake-host",
      labels: ["gemini"],
      repoDir: "/repos/openclaw",
      at: "2026-03-18T11:00:00.000Z",
    });

    const dispatch = createDispatch(state, {
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

    const snapshot = buildDashboardSnapshot(state, {
      now: "2026-03-18T11:01:05.000Z",
    });
    expect(snapshot.tasks[0]).toMatchObject({
      status: "assigned",
      assignedWorkerId: "codex-snake",
      targetWorkerId: "codex-snake",
    });
  });

  it("saveRuntimeState writes atomically via tmp + rename when using JSON backend", () => {
    const originalEnv = process.env.RUNTIME_STATE_BACKEND;
    process.env.RUNTIME_STATE_BACKEND = "json";

    const stateDir = makeTempDir();

    let state = loadRuntimeState(stateDir);
    state = registerWorker(state, {
      workerId: "codex-atomic-test",
      pool: "codex",
      hostname: "test-host",
      labels: ["codex"],
      repoDir: "/repos/test",
      at: "2026-03-31T10:00:00.000Z",
    });

    saveRuntimeState(stateDir, state);

    const filePath = path.join(stateDir, "runtime-state.json");
    const tmpFilePath = `${filePath}.tmp`;
    expect(fs.existsSync(tmpFilePath)).toBe(false);
    expect(fs.existsSync(filePath)).toBe(true);

    const content = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(content.workers).toHaveLength(1);
    expect(content.workers[0].id).toBe("codex-atomic-test");

    const reloaded = loadRuntimeState(stateDir);
    expect(reloaded.workers[0].id).toBe("codex-atomic-test");

    if (originalEnv !== undefined) {
      process.env.RUNTIME_STATE_BACKEND = originalEnv;
    } else {
      delete process.env.RUNTIME_STATE_BACKEND;
    }
  });

  it("createEmptyRuntimeState returns valid initial state", () => {
    const state = createEmptyRuntimeState();

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

  it("supports chatMode field in task and assignment", () => {
    const stateDir = makeTempDir();

    let state = loadRuntimeState(stateDir);
    state = registerWorker(state, {
      workerId: "codex-chatmode-ts-test",
      pool: "codex",
      hostname: "test-host",
      labels: ["codex"],
      repoDir: "/repos/test",
      at: "2026-04-01T10:00:00.000Z",
    });

    const dispatch = createDispatch(state, {
      repo: "TingRuDeng/ForgeFlow",
      defaultBranch: "main",
      requestedBy: "test",
      tasks: [
        {
          id: "task-chatmode-ts",
          title: "ChatMode TS test task",
          pool: "codex",
          allowedPaths: ["src/**"],
          acceptance: ["test"],
          dependsOn: [],
          branchName: "ai/codex/task-chatmode-ts",
          verification: { mode: "run" },
        },
      ],
      packages: [
        {
          taskId: "task-chatmode-ts",
          assignment: {
            taskId: "task-chatmode-ts",
            workerId: "placeholder",
            pool: "codex",
            status: "assigned",
            branchName: "ai/codex/task-chatmode-ts",
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

    const task = state.tasks.find((item) => item.id === dispatch.taskIds[0]);
    expect(task?.chatMode).toBe("new_chat");

    const assignment = state.assignments.find((item) => item.taskId === dispatch.taskIds[0]);
    expect(assignment?.assignment.chatMode).toBe("new_chat");

    const assignedTask = getAssignedTaskForWorker(state, "codex-chatmode-ts-test");
    expect(assignedTask?.chatMode).toBe("new_chat");
  });

  it("defaults to SQLite backend and creates .db file", () => {
    const stateDir = makeTempDir();

    let state = loadRuntimeState(stateDir);
    state = registerWorker(state, {
      workerId: "codex-sqlite-default-test",
      pool: "codex",
      hostname: "test-host",
      labels: ["codex"],
      repoDir: "/repos/test",
      at: "2026-04-01T10:00:00.000Z",
    });

    saveRuntimeState(stateDir, state);

    const dbPath = path.join(stateDir, "runtime-state.db");
    expect(fs.existsSync(dbPath)).toBe(true);

    const reloaded = loadRuntimeState(stateDir);
    expect(reloaded.workers[0].id).toBe("codex-sqlite-default-test");
  });

  it("uses JSON backend when RUNTIME_STATE_BACKEND=json", () => {
    const originalEnv = process.env.RUNTIME_STATE_BACKEND;
    process.env.RUNTIME_STATE_BACKEND = "json";

    const stateDir = makeTempDir();

    let state = loadRuntimeState(stateDir);
    state = registerWorker(state, {
      workerId: "codex-json-backend-test",
      pool: "codex",
      hostname: "test-host",
      labels: ["codex"],
      repoDir: "/repos/test",
      at: "2026-04-01T10:00:00.000Z",
    });

    saveRuntimeState(stateDir, state);

    const jsonPath = path.join(stateDir, "runtime-state.json");
    expect(fs.existsSync(jsonPath)).toBe(true);

    const reloaded = loadRuntimeState(stateDir);
    expect(reloaded.workers[0].id).toBe("codex-json-backend-test");

    if (originalEnv !== undefined) {
      process.env.RUNTIME_STATE_BACKEND = originalEnv;
    } else {
      delete process.env.RUNTIME_STATE_BACKEND;
    }
  });

  it("auto-imports from JSON when SQLite db does not exist but JSON file exists", () => {
    const stateDir = makeTempDir();

    const originalEnv = process.env.RUNTIME_STATE_BACKEND;
    process.env.RUNTIME_STATE_BACKEND = "json";

    let jsonState = loadRuntimeState(stateDir);
    jsonState = registerWorker(jsonState, {
      workerId: "codex-migration-test",
      pool: "codex",
      hostname: "test-host",
      labels: ["codex"],
      repoDir: "/repos/test",
      at: "2026-04-01T10:00:00.000Z",
    });
    saveRuntimeState(stateDir, jsonState);

    const jsonPath = path.join(stateDir, "runtime-state.json");
    expect(fs.existsSync(jsonPath)).toBe(true);

    process.env.RUNTIME_STATE_BACKEND = "sqlite";

    const reloaded = loadRuntimeState(stateDir);
    expect(reloaded.workers[0].id).toBe("codex-migration-test");

    const dbPath = path.join(stateDir, "runtime-state.db");
    expect(fs.existsSync(dbPath)).toBe(true);

    if (originalEnv !== undefined) {
      process.env.RUNTIME_STATE_BACKEND = originalEnv;
    } else {
      delete process.env.RUNTIME_STATE_BACKEND;
    }
  });

  it("createEmptyRuntimeState uses default SQLite backend", () => {
    const originalEnv = process.env.RUNTIME_STATE_BACKEND;
    process.env.RUNTIME_STATE_BACKEND = undefined;

    const state = createEmptyRuntimeState();

    expect(state.version).toBe(1);
    expect(state.sequence).toBe(0);
    expect(state.workers).toHaveLength(0);

    if (originalEnv !== undefined) {
      process.env.RUNTIME_STATE_BACKEND = originalEnv;
    }
  });

  it("createDispatch preserves continuation fields when provided", () => {
    const stateDir = makeTempDir();

    let state = loadRuntimeState(stateDir);
    state = registerWorker(state, {
      workerId: "codex-continuation-test",
      pool: "codex",
      hostname: "test-host",
      labels: ["codex"],
      repoDir: "/repos/test",
      at: "2026-04-01T10:00:00.000Z",
    });

    const dispatch = createDispatch(state, {
      repo: "TingRuDeng/ForgeFlow",
      defaultBranch: "main",
      requestedBy: "test",
      tasks: [
        {
          id: "task-cont",
          title: "Continuation test task",
          pool: "codex",
          allowedPaths: ["src/**"],
          acceptance: ["test"],
          dependsOn: [],
          branchName: "ai/codex/task-cont",
          verification: { mode: "run" },
          continuationMode: "continue",
          continueFromTaskId: "dispatch-1:task-1",
        },
      ],
      packages: [
        {
          taskId: "task-cont",
          assignment: {
            taskId: "task-cont",
            workerId: "codex-continuation-test",
            pool: "codex",
            status: "assigned",
            branchName: "ai/codex/task-cont",
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

    const task = state.tasks.find((item) => item.id === dispatch.taskIds[0]);
    expect(task?.continuationMode).toBe("continue");
    expect(task?.continueFromTaskId).toBe("dispatch-1:task-1");

    const assignment = state.assignments.find((item) => item.taskId === dispatch.taskIds[0]);
    expect(assignment?.assignment.continuationMode).toBe("continue");
    expect(assignment?.assignment.continueFromTaskId).toBe("dispatch-1:task-1");
  });

  it("getAssignedTaskForWorker returns continuation fields", () => {
    const stateDir = makeTempDir();

    let state = loadRuntimeState(stateDir);
    state = registerWorker(state, {
      workerId: "codex-continuation-fetch-test",
      pool: "codex",
      hostname: "test-host",
      labels: ["codex"],
      repoDir: "/repos/test",
      at: "2026-04-01T10:00:00.000Z",
    });

    const dispatch = createDispatch(state, {
      repo: "TingRuDeng/ForgeFlow",
      defaultBranch: "main",
      requestedBy: "test",
      tasks: [
        {
          id: "task-cont-fetch",
          title: "Continuation fetch test task",
          pool: "codex",
          allowedPaths: ["src/**"],
          acceptance: ["test"],
          dependsOn: [],
          branchName: "ai/codex/task-cont-fetch",
          verification: { mode: "run" },
          continuationMode: "continue",
          continueFromTaskId: "dispatch-2:task-1",
        },
      ],
      packages: [
        {
          taskId: "task-cont-fetch",
          assignment: {
            taskId: "task-cont-fetch",
            workerId: "codex-continuation-fetch-test",
            pool: "codex",
            status: "assigned",
            branchName: "ai/codex/task-cont-fetch",
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

    const assignedTask = getAssignedTaskForWorker(state, "codex-continuation-fetch-test");
    expect(assignedTask?.continuationMode).toBe("continue");
    expect(assignedTask?.continueFromTaskId).toBe("dispatch-2:task-1");
  });

  it("dashboard snapshot returns tasks in descending order (newest first)", () => {
    const stateDir = makeTempDir();

    let state = loadRuntimeState(stateDir);
    state = registerWorker(state, {
      workerId: "codex-order-test",
      pool: "codex",
      hostname: "test-host",
      labels: ["codex"],
      repoDir: "/repos/test",
      at: "2026-04-02T10:00:00.000Z",
    });

    const dispatch1 = createDispatch(state, {
      repo: "TingRuDeng/ForgeFlow",
      defaultBranch: "main",
      requestedBy: "test",
      tasks: [
        {
          id: "task-1",
          title: "First task",
          pool: "codex",
          allowedPaths: ["src/**"],
          acceptance: ["test"],
          dependsOn: [],
          branchName: "ai/codex/task-1",
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
            branchName: "ai/codex/task-1",
            allowedPaths: ["src/**"],
            repo: "TingRuDeng/ForgeFlow",
            defaultBranch: "main",
          },
          workerPrompt: "Test prompt",
        },
      ],
      createdAt: "2026-04-02T10:00:10.000Z",
    });
    state = dispatch1.state;

    const dispatch2 = createDispatch(state, {
      repo: "TingRuDeng/ForgeFlow",
      defaultBranch: "main",
      requestedBy: "test",
      tasks: [
        {
          id: "task-2",
          title: "Second task",
          pool: "codex",
          allowedPaths: ["src/**"],
          acceptance: ["test"],
          dependsOn: [],
          branchName: "ai/codex/task-2",
          verification: { mode: "run" },
        },
      ],
      packages: [
        {
          taskId: "task-2",
          assignment: {
            taskId: "task-2",
            workerId: null,
            pool: "codex",
            status: "pending",
            branchName: "ai/codex/task-2",
            allowedPaths: ["src/**"],
            repo: "TingRuDeng/ForgeFlow",
            defaultBranch: "main",
          },
          workerPrompt: "Test prompt",
        },
      ],
      createdAt: "2026-04-02T10:01:00.000Z",
    });
    state = dispatch2.state;

    const dispatch3 = createDispatch(state, {
      repo: "TingRuDeng/ForgeFlow",
      defaultBranch: "main",
      requestedBy: "test",
      tasks: [
        {
          id: "task-3",
          title: "Third task",
          pool: "codex",
          allowedPaths: ["src/**"],
          acceptance: ["test"],
          dependsOn: [],
          branchName: "ai/codex/task-3",
          verification: { mode: "run" },
        },
      ],
      packages: [
        {
          taskId: "task-3",
          assignment: {
            taskId: "task-3",
            workerId: null,
            pool: "codex",
            status: "pending",
            branchName: "ai/codex/task-3",
            allowedPaths: ["src/**"],
            repo: "TingRuDeng/ForgeFlow",
            defaultBranch: "main",
          },
          workerPrompt: "Test prompt",
        },
      ],
      createdAt: "2026-04-02T10:02:00.000Z",
    });
    state = dispatch3.state;

    const snapshot = buildDashboardSnapshot(state, {
      now: "2026-04-02T10:02:10.000Z",
    });

    expect(snapshot.tasks).toHaveLength(3);
    expect(snapshot.tasks[0].id).toBe(dispatch3.taskIds[0]);
    expect(snapshot.tasks[1].id).toBe(dispatch2.taskIds[0]);
    expect(snapshot.tasks[2].id).toBe(dispatch1.taskIds[0]);
    expect(snapshot.tasks[0].createdAt).toBe("2026-04-02T10:02:00.000Z");
    expect(snapshot.tasks[1].createdAt).toBe("2026-04-02T10:01:00.000Z");
    expect(snapshot.tasks[2].createdAt).toBe("2026-04-02T10:00:10.000Z");
  });

  it("disableWorker marks worker as disabled and excludes from scheduling", () => {
    const stateDir = makeTempDir();

    let state = loadRuntimeState(stateDir);
    state = registerWorker(state, {
      workerId: "codex-disable-test",
      pool: "codex",
      hostname: "test-host",
      labels: ["codex"],
      repoDir: "/repos/test",
      at: "2026-04-02T10:00:00.000Z",
    });
    state = registerWorker(state, {
      workerId: "codex-active-test",
      pool: "codex",
      hostname: "test-host-2",
      labels: ["codex"],
      repoDir: "/repos/test",
      at: "2026-04-02T10:00:01.000Z",
    });

    const dispatch = createDispatch(state, {
      repo: "TingRuDeng/openclaw-multi-agent-mvp",
      defaultBranch: "master",
      requestedBy: "codex-control",
      tasks: [
        {
          id: "task-disable",
          title: "Test task for disabled worker",
          pool: "codex",
          allowedPaths: ["src/**"],
          acceptance: ["test"],
          dependsOn: [],
          branchName: "ai/codex/task-disable",
          verification: { mode: "run" },
        },
      ],
      packages: [
        {
          taskId: "task-disable",
          assignment: {
            taskId: "task-disable",
            workerId: null,
            pool: "codex",
            status: "pending",
            branchName: "ai/codex/task-disable",
            allowedPaths: ["src/**"],
            repo: "TingRuDeng/openclaw-multi-agent-mvp",
            defaultBranch: "master",
          },
          workerPrompt: "Test prompt",
        },
      ],
      createdAt: "2026-04-02T10:00:00.000Z",
    });
    state = dispatch.state;

    state = disableWorker(state, {
      workerId: "codex-disable-test",
      disabledBy: "test-user",
      at: "2026-04-02T10:00:05.000Z",
    });

    const snapshot = buildDashboardSnapshot(state, {
      now: "2026-04-02T10:00:10.000Z",
    });
    const disabledWorker = snapshot.workers.find((w) => w.id === "codex-disable-test");
    expect(disabledWorker).toMatchObject({
      status: "disabled",
      disabledAt: "2026-04-02T10:00:05.000Z",
      disabledBy: "test-user",
    });
    expect(snapshot.stats.workers.disabled).toBe(1);
    const activeWorker = snapshot.workers.find((w) => w.id === "codex-active-test");
    expect(activeWorker).toMatchObject({
      status: "idle",
    });
    expect(activeWorker?.disabledAt).toBeFalsy();
  });

  it("disabled worker cannot claim tasks", () => {
    const stateDir = makeTempDir();

    let state = loadRuntimeState(stateDir);
    state = registerWorker(state, {
      workerId: "codex-disabled-claim-test",
      pool: "codex",
      hostname: "test-host",
      labels: ["codex"],
      repoDir: "/repos/test",
      at: "2026-04-02T10:00:00.000Z",
    });
    const dispatch = createDispatch(state, {
      repo: "TingRuDeng/openclaw-multi-agent-mvp",
      defaultBranch: "master",
      requestedBy: "codex-control",
      tasks: [
        {
          id: "task-claim-disabled",
          title: "Test task for claiming by disabled worker",
          pool: "codex",
          allowedPaths: ["src/**"],
          acceptance: ["test"],
          dependsOn: [],
          branchName: "ai/codex/task-claim-disabled",
          verification: { mode: "run" },
        },
      ],
      packages: [
        {
          taskId: "task-claim-disabled",
          assignment: {
            taskId: "task-claim-disabled",
            workerId: null,
            pool: "codex",
            status: "pending",
            branchName: "ai/codex/task-claim-disabled",
            allowedPaths: ["src/**"],
            repo: "TingRuDeng/openclaw-multi-agent-mvp",
            defaultBranch: "master",
          },
          workerPrompt: "Test prompt",
        },
      ],
      createdAt: "2026-04-02T10:00:00.000Z",
    });
    state = dispatch.state;
    state = disableWorker(state, {
      workerId: "codex-disabled-claim-test",
      at: "2026-04-02T10:00:05.000Z",
    });
    const claimResult = claimAssignedTaskForWorker(state, {
      workerId: "codex-disabled-claim-test",
      at: "2026-04-02T10:00:06.000Z",
    });
    expect(claimResult.assignment).toBeNull();
  });

  it("enableWorker restores a previously disabled worker", () => {
    const stateDir = makeTempDir();

    let state = loadRuntimeState(stateDir);
    state = registerWorker(state, {
      workerId: "codex-restore-test",
      pool: "codex",
      hostname: "test-host",
      labels: ["codex"],
      repoDir: "/repos/test",
      at: "2026-04-02T10:00:00.000Z",
    });
    state = disableWorker(state, {
      workerId: "codex-restore-test",
      disabledBy: "admin",
      at: "2026-04-02T10:00:05.000Z",
    });
    state = enableWorker(state, {
      workerId: "codex-restore-test",
      at: "2026-04-02T10:00:10.000Z",
    });
    const snapshot = buildDashboardSnapshot(state, {
      now: "2026-04-02T10:00:11.000Z",
    });
    const worker = snapshot.workers.find((w) => w.id === "codex-restore-test");
    expect(worker).toMatchObject({
      status: "idle",
    });
    expect(worker?.disabledAt).toBeFalsy();
    expect(worker?.disabledBy).toBeFalsy();
  });

  it("disabled worker is preserved in workers list", () => {
    const stateDir = makeTempDir();

    let state = loadRuntimeState(stateDir);
    state = registerWorker(state, {
      workerId: "codex-preserve-test",
      pool: "codex",
      hostname: "test-host",
      labels: ["codex"],
      repoDir: "/repos/test",
      at: "2026-04-02T10:00:00.000Z",
    });
    state = disableWorker(state, {
      workerId: "codex-preserve-test",
      at: "2026-04-02T10:00:05.000Z",
    });
    const snapshot = buildDashboardSnapshot(state, {
      now: "2026-04-02T10:00:10.000Z",
    });
    expect(snapshot.workers).toHaveLength(1);
    const worker = snapshot.workers.find((w) => w.id === "codex-preserve-test");
    expect(worker).toBeDefined();
    expect(worker?.disabledAt).toBeDefined();
  });

  it("recordWorkerResult stores worker result as evidence in review", () => {
    const stateDir = makeTempDir();

    let state = loadRuntimeState(stateDir);
    state = registerWorker(state, {
      workerId: "codex-evidence-test",
      pool: "codex",
      hostname: "test-host",
      labels: ["codex"],
      repoDir: "/repos/test",
      at: "2026-04-03T10:00:00.000Z",
    });

    const dispatch = createDispatch(state, {
      repo: "TingRuDeng/ForgeFlow",
      defaultBranch: "main",
      requestedBy: "test",
      tasks: [
        {
          id: "task-evidence",
          title: "Evidence test task",
          pool: "codex",
          allowedPaths: ["src/**"],
          acceptance: ["test"],
          dependsOn: [],
          branchName: "ai/codex/task-evidence",
          verification: { mode: "run" },
        },
      ],
      packages: [
        {
          taskId: "task-evidence",
          assignment: {
            taskId: "task-evidence",
            workerId: "codex-evidence-test",
            pool: "codex",
            status: "assigned",
            branchName: "ai/codex/task-evidence",
            allowedPaths: ["src/**"],
            repo: "TingRuDeng/ForgeFlow",
            defaultBranch: "main",
          },
          workerPrompt: "Test prompt",
        },
      ],
      createdAt: "2026-04-03T10:00:10.000Z",
    });
    state = dispatch.state;

    state = recordWorkerResult(state, {
      workerId: "codex-evidence-test",
      result: {
        taskId: dispatch.taskIds[0],
        workerId: "codex-evidence-test",
        provider: "codex",
        pool: "codex",
        branchName: "ai/codex/task-evidence",
        repo: "TingRuDeng/ForgeFlow",
        defaultBranch: "main",
        mode: "run",
        output: "done",
        generatedAt: "2026-04-03T10:05:00.000Z",
        verification: {
          allPassed: true,
          commands: [
            { command: "pnpm test", exitCode: 0, output: "ok" },
            { command: "pnpm typecheck", exitCode: 0, output: "ok" },
          ],
        },
      },
      changedFiles: ["src/main.ts", "src/utils.ts"],
      pullRequest: {
        number: 42,
        url: "https://github.com/TingRuDeng/ForgeFlow/pull/42",
        headBranch: "ai/codex/task-evidence",
        baseBranch: "main",
      },
    });

    const review = state.reviews.find((r) => r.taskId === dispatch.taskIds[0]);
    expect(review).toBeDefined();
    expect(review?.evidence).toBeDefined();
    expect(review?.evidence?.taskId).toBe(dispatch.taskIds[0]);
    expect(review?.evidence?.verification.allPassed).toBe(true);
    expect(review?.evidence?.verification.commands).toHaveLength(2);
  });

  it("recordReviewDecision preserves reviewMaterial when recording merge decision", () => {
    const stateDir = makeTempDir();

    let state = loadRuntimeState(stateDir);
    state = registerWorker(state, {
      workerId: "codex-material-preserve-test",
      pool: "codex",
      hostname: "test-host",
      labels: ["codex"],
      repoDir: "/repos/test",
      at: "2026-04-03T11:00:00.000Z",
    });

    const dispatch = createDispatch(state, {
      repo: "TingRuDeng/ForgeFlow",
      defaultBranch: "main",
      requestedBy: "test",
      tasks: [
        {
          id: "task-material",
          title: "Material preserve test",
          pool: "codex",
          allowedPaths: ["src/**"],
          acceptance: ["test"],
          dependsOn: [],
          branchName: "ai/codex/task-material",
          verification: { mode: "run" },
        },
      ],
      packages: [
        {
          taskId: "task-material",
          assignment: {
            taskId: "task-material",
            workerId: "codex-material-preserve-test",
            pool: "codex",
            status: "assigned",
            branchName: "ai/codex/task-material",
            allowedPaths: ["src/**"],
            repo: "TingRuDeng/ForgeFlow",
            defaultBranch: "main",
          },
          workerPrompt: "Test prompt",
        },
      ],
      createdAt: "2026-04-03T11:00:10.000Z",
    });
    state = dispatch.state;
    const taskId = dispatch.taskIds[0];

    state = recordWorkerResult(state, {
      workerId: "codex-material-preserve-test",
      result: {
        taskId,
        workerId: "codex-material-preserve-test",
        provider: "codex",
        pool: "codex",
        branchName: "ai/codex/task-material",
        repo: "TingRuDeng/ForgeFlow",
        defaultBranch: "main",
        mode: "run",
        output: "done",
        generatedAt: "2026-04-03T11:05:00.000Z",
        verification: {
          allPassed: true,
          commands: [{ command: "pnpm test", exitCode: 0, output: "ok" }],
        },
      },
      changedFiles: ["src/main.ts"],
      pullRequest: {
        number: 50,
        url: "https://github.com/TingRuDeng/ForgeFlow/pull/50",
        headBranch: "ai/codex/task-material",
        baseBranch: "main",
      },
    });

    const reviewBeforeDecision = state.reviews.find((r) => r.taskId === taskId);
    expect(reviewBeforeDecision?.reviewMaterial).toBeDefined();
    expect(reviewBeforeDecision?.reviewMaterial?.changedFiles).toEqual(["src/main.ts"]);
    expect(reviewBeforeDecision?.reviewMaterial?.selfTestPassed).toBe(true);

    state = recordReviewDecision(state, {
      taskId,
      decision: "merge",
      actor: "reviewer",
      notes: "looks good",
      at: "2026-04-03T11:06:00.000Z",
    });

    const reviewAfterDecision = state.reviews.find((r) => r.taskId === taskId);
    expect(reviewAfterDecision?.decision).toBe("merge");
    expect(reviewAfterDecision?.reviewMaterial).toBeDefined();
    expect(reviewAfterDecision?.reviewMaterial?.changedFiles).toEqual(["src/main.ts"]);
    expect(reviewAfterDecision?.reviewMaterial?.selfTestPassed).toBe(true);
  });

  it("recordReviewDecision preserves reviewMaterial when recording block decision", () => {
    const stateDir = makeTempDir();

    let state = loadRuntimeState(stateDir);
    state = registerWorker(state, {
      workerId: "codex-block-material-test",
      pool: "codex",
      hostname: "test-host",
      labels: ["codex"],
      repoDir: "/repos/test",
      at: "2026-04-03T12:00:00.000Z",
    });

    const dispatch = createDispatch(state, {
      repo: "TingRuDeng/ForgeFlow",
      defaultBranch: "main",
      requestedBy: "test",
      tasks: [
        {
          id: "task-block-material",
          title: "Block material preserve test",
          pool: "codex",
          allowedPaths: ["src/**"],
          acceptance: ["test"],
          dependsOn: [],
          branchName: "ai/codex/task-block-material",
          verification: { mode: "run" },
        },
      ],
      packages: [
        {
          taskId: "task-block-material",
          assignment: {
            taskId: "task-block-material",
            workerId: "codex-block-material-test",
            pool: "codex",
            status: "assigned",
            branchName: "ai/codex/task-block-material",
            allowedPaths: ["src/**"],
            repo: "TingRuDeng/ForgeFlow",
            defaultBranch: "main",
          },
          workerPrompt: "Test prompt",
        },
      ],
      createdAt: "2026-04-03T12:00:10.000Z",
    });
    state = dispatch.state;
    const taskId = dispatch.taskIds[0];

    state = recordWorkerResult(state, {
      workerId: "codex-block-material-test",
      result: {
        taskId,
        workerId: "codex-block-material-test",
        provider: "codex",
        pool: "codex",
        branchName: "ai/codex/task-block-material",
        repo: "TingRuDeng/ForgeFlow",
        defaultBranch: "main",
        mode: "run",
        output: "done",
        generatedAt: "2026-04-03T12:05:00.000Z",
        verification: {
          allPassed: true,
          commands: [{ command: "pnpm test", exitCode: 0, output: "ok" }],
        },
      },
      changedFiles: ["src/app.ts"],
      pullRequest: {
        number: 55,
        url: "https://github.com/TingRuDeng/ForgeFlow/pull/55",
        headBranch: "ai/codex/task-block-material",
        baseBranch: "main",
      },
    });

    state = recordReviewDecision(state, {
      taskId,
      decision: "block",
      actor: "reviewer",
      notes: "needs changes",
      at: "2026-04-03T12:06:00.000Z",
    });

    const review = state.reviews.find((r) => r.taskId === taskId);
    expect(review?.decision).toBe("block");
    expect(review?.reviewMaterial).toBeDefined();
    expect(review?.reviewMaterial?.changedFiles).toEqual(["src/app.ts"]);
  });

  it("recordReviewDecision preserves reviewMaterial when recording rework decision", () => {
    const stateDir = makeTempDir();

    let state = loadRuntimeState(stateDir);
    state = registerWorker(state, {
      workerId: "codex-rework-material-test",
      pool: "codex",
      hostname: "test-host",
      labels: ["codex"],
      repoDir: "/repos/test",
      at: "2026-04-03T13:00:00.000Z",
    });

    const dispatch = createDispatch(state, {
      repo: "TingRuDeng/ForgeFlow",
      defaultBranch: "main",
      requestedBy: "test",
      tasks: [
        {
          id: "task-rework-material",
          title: "Rework material preserve test",
          pool: "codex",
          allowedPaths: ["src/**"],
          acceptance: ["test"],
          dependsOn: [],
          branchName: "ai/codex/task-rework-material",
          verification: { mode: "run" },
        },
      ],
      packages: [
        {
          taskId: "task-rework-material",
          assignment: {
            taskId: "task-rework-material",
            workerId: "codex-rework-material-test",
            pool: "codex",
            status: "assigned",
            branchName: "ai/codex/task-rework-material",
            allowedPaths: ["src/**"],
            repo: "TingRuDeng/ForgeFlow",
            defaultBranch: "main",
          },
          workerPrompt: "Test prompt",
        },
      ],
      createdAt: "2026-04-03T13:00:10.000Z",
    });
    state = dispatch.state;
    const taskId = dispatch.taskIds[0];

    state = recordWorkerResult(state, {
      workerId: "codex-rework-material-test",
      result: {
        taskId,
        workerId: "codex-rework-material-test",
        provider: "codex",
        pool: "codex",
        branchName: "ai/codex/task-rework-material",
        repo: "TingRuDeng/ForgeFlow",
        defaultBranch: "main",
        mode: "run",
        output: "done",
        generatedAt: "2026-04-03T13:05:00.000Z",
        verification: {
          allPassed: true,
          commands: [{ command: "pnpm test", exitCode: 0, output: "ok" }],
        },
      },
      changedFiles: ["src/service.ts"],
      pullRequest: {
        number: 60,
        url: "https://github.com/TingRuDeng/ForgeFlow/pull/60",
        headBranch: "ai/codex/task-rework-material",
        baseBranch: "main",
      },
    });

    state = recordReviewDecision(state, {
      taskId,
      decision: "rework",
      actor: "reviewer",
      notes: "please add tests",
      at: "2026-04-03T13:06:00.000Z",
    });

    const review = state.reviews.find((r) => r.taskId === taskId);
    expect(review?.decision).toBe("rework");
    expect(review?.reviewMaterial).toBeDefined();
    expect(review?.reviewMaterial?.changedFiles).toEqual(["src/service.ts"]);
  });

  it("recordReviewDecision preserves evidence when recording decision", () => {
    const stateDir = makeTempDir();

    let state = loadRuntimeState(stateDir);
    state = registerWorker(state, {
      workerId: "codex-evidence-preserve-test",
      pool: "codex",
      hostname: "test-host",
      labels: ["codex"],
      repoDir: "/repos/test",
      at: "2026-04-03T14:00:00.000Z",
    });

    const dispatch = createDispatch(state, {
      repo: "TingRuDeng/ForgeFlow",
      defaultBranch: "main",
      requestedBy: "test",
      tasks: [
        {
          id: "task-evidence-preserve",
          title: "Evidence preserve test",
          pool: "codex",
          allowedPaths: ["src/**"],
          acceptance: ["test"],
          dependsOn: [],
          branchName: "ai/codex/task-evidence-preserve",
          verification: { mode: "run" },
        },
      ],
      packages: [
        {
          taskId: "task-evidence-preserve",
          assignment: {
            taskId: "task-evidence-preserve",
            workerId: "codex-evidence-preserve-test",
            pool: "codex",
            status: "assigned",
            branchName: "ai/codex/task-evidence-preserve",
            allowedPaths: ["src/**"],
            repo: "TingRuDeng/ForgeFlow",
            defaultBranch: "main",
          },
          workerPrompt: "Test prompt",
        },
      ],
      createdAt: "2026-04-03T14:00:10.000Z",
    });
    state = dispatch.state;
    const taskId = dispatch.taskIds[0];

    state = recordWorkerResult(state, {
      workerId: "codex-evidence-preserve-test",
      result: {
        taskId,
        workerId: "codex-evidence-preserve-test",
        provider: "codex",
        pool: "codex",
        branchName: "ai/codex/task-evidence-preserve",
        repo: "TingRuDeng/ForgeFlow",
        defaultBranch: "main",
        mode: "run",
        output: "done",
        generatedAt: "2026-04-03T14:05:00.000Z",
        verification: {
          allPassed: true,
          commands: [
            { command: "pnpm test", exitCode: 0, output: "ok" },
            { command: "pnpm typecheck", exitCode: 0, output: "ok" },
          ],
        },
      },
      changedFiles: ["src/controller.ts"],
      pullRequest: {
        number: 65,
        url: "https://github.com/TingRuDeng/ForgeFlow/pull/65",
        headBranch: "ai/codex/task-evidence-preserve",
        baseBranch: "main",
      },
    });

    const reviewBefore = state.reviews.find((r) => r.taskId === taskId);
    expect(reviewBefore?.evidence).toBeDefined();
    expect(reviewBefore?.evidence?.verification.commands).toHaveLength(2);

    state = recordReviewDecision(state, {
      taskId,
      decision: "merge",
      actor: "reviewer",
      notes: "approved",
      at: "2026-04-03T14:06:00.000Z",
    });

    const reviewAfter = state.reviews.find((r) => r.taskId === taskId);
    expect(reviewAfter?.evidence).toBeDefined();
    expect(reviewAfter?.evidence?.verification.commands).toHaveLength(2);
    expect(reviewAfter?.evidence?.taskId).toBe(taskId);
  });
});
