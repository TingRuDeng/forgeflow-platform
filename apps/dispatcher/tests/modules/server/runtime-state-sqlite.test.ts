import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { RuntimeState } from "../../../src/modules/server/runtime-state.js";

import {
  loadRuntimeState,
  saveRuntimeState,
  sqliteStore,
} from "../../../src/modules/server/runtime-state-sqlite.js";

const { DatabaseSync } = await import("node:sqlite");

const tempRoots: string[] = [];

function makeTempDir(): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-sqlite-state-"));
  tempRoots.push(tempDir);
  return tempDir;
}

afterEach(() => {
  for (const tempDir of tempRoots.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

function createTestState(): RuntimeState {
  return {
    version: 1,
    updatedAt: "2026-04-01T10:00:00.000Z",
    sequence: 1,
    workers: [
      {
        id: "test-worker-1",
        pool: "codex",
        hostname: "test-host",
        labels: ["test"],
        repoDir: "/repos/test",
        status: "idle",
        lastHeartbeatAt: "2026-04-01T10:00:00.000Z",
      },
    ],
    tasks: [
      {
        id: "dispatch-1:task-1",
        externalTaskId: "task-1",
        repo: "TingRuDeng/test",
        defaultBranch: "main",
        title: "Test task",
        pool: "codex",
        allowedPaths: ["src/**"],
        acceptance: ["test passed"],
        dependsOn: [],
        branchName: "ai/codex/test-task",
        status: "ready",
        assignedWorkerId: null,
        lastAssignedWorkerId: null,
        requestedBy: "test",
        createdAt: "2026-04-01T10:00:00.000Z",
        verification: { mode: "run" },
      },
    ],
    events: [
      {
        taskId: "dispatch-1:task-1",
        type: "created",
        at: "2026-04-01T10:00:00.000Z",
        payload: { status: "planned" },
      },
    ],
    assignments: [
      {
        taskId: "dispatch-1:task-1",
        workerId: null,
        pool: "codex",
        status: "pending",
        assignment: {
          taskId: "dispatch-1:task-1",
          workerId: null,
          pool: "codex",
          status: "pending",
          branchName: "ai/codex/test-task",
          allowedPaths: ["src/**"],
          repo: "TingRuDeng/test",
          defaultBranch: "main",
        },
        assignedAt: null,
        claimedAt: null,
      },
    ],
    reviews: [
      {
        taskId: "dispatch-1:task-1",
        decision: "pending",
        actor: null,
        notes: "",
        decidedAt: null,
        reviewMaterial: null,
      },
    ],
    pullRequests: [],
    dispatches: [
      {
        id: "dispatch-1",
        repo: "TingRuDeng/test",
        defaultBranch: "main",
        requestedBy: "test",
        createdAt: "2026-04-01T10:00:00.000Z",
        taskIds: ["dispatch-1:task-1"],
      },
    ],
  };
}

describe("runtime-state-sqlite", () => {
  it("initializes empty database when no db file exists", () => {
    const stateDir = makeTempDir();

    const state = loadRuntimeState(stateDir);

    expect(state.version).toBe(1);
    expect(state.workers).toHaveLength(0);
    expect(state.tasks).toHaveLength(0);
  });

  it("saves runtime state to sqlite file", () => {
    const stateDir = makeTempDir();
    const state = createTestState();

    saveRuntimeState(stateDir, state);

    const dbPath = path.join(stateDir, "runtime-state.db");
    expect(fs.existsSync(dbPath)).toBe(true);
  });

  it("reloads runtime state from sqlite file", () => {
    const stateDir = makeTempDir();
    const originalState = createTestState();

    saveRuntimeState(stateDir, originalState);
    const reloaded = loadRuntimeState(stateDir);

    expect(reloaded.version).toBe(1);
    expect(reloaded.workers).toHaveLength(1);
    expect(reloaded.workers[0].id).toBe("test-worker-1");
    expect(reloaded.tasks).toHaveLength(1);
    expect(reloaded.tasks[0].id).toBe("dispatch-1:task-1");
    expect(reloaded.dispatches).toHaveLength(1);
    expect(reloaded.dispatches[0].id).toBe("dispatch-1");
  });

  it("imports from existing JSON snapshot", () => {
    const stateDir = makeTempDir();
    const jsonState = JSON.stringify(createTestState());

    const imported = sqliteStore.importFromJson(stateDir, jsonState);

    expect(imported.workers).toHaveLength(1);
    expect(imported.workers[0].id).toBe("test-worker-1");

    const reloaded = loadRuntimeState(stateDir);
    expect(reloaded.workers[0].id).toBe("test-worker-1");
  });

  it("persists state after reopening backend", () => {
    const stateDir = makeTempDir();
    const state1 = createTestState();

    saveRuntimeState(stateDir, state1);

    const reloaded1 = loadRuntimeState(stateDir);
    expect(reloaded1.workers[0].id).toBe("test-worker-1");

    const state2: RuntimeState = {
      ...reloaded1,
      workers: [
        ...reloaded1.workers,
        {
          id: "test-worker-2",
          pool: "gemini",
          hostname: "test-host-2",
          labels: ["test"],
          repoDir: "/repos/test2",
          status: "idle",
          lastHeartbeatAt: "2026-04-01T11:00:00.000Z",
        },
      ],
    };
    saveRuntimeState(stateDir, state2);

    const reloaded2 = loadRuntimeState(stateDir);
    expect(reloaded2.workers).toHaveLength(2);
    expect(reloaded2.workers[1].id).toBe("test-worker-2");
  });

  it("returns empty state for corrupted db file", () => {
    const stateDir = makeTempDir();
    const dbPath = path.join(stateDir, "runtime-state.db");
    fs.writeFileSync(dbPath, "not a valid sqlite database");

    const state = loadRuntimeState(stateDir);

    expect(state.version).toBe(1);
    expect(state.workers).toHaveLength(0);
  });

  it("updates existing snapshot on save", () => {
    const stateDir = makeTempDir();
    const state = createTestState();

    saveRuntimeState(stateDir, state);

    const updatedState: RuntimeState = {
      ...state,
      workers: [
        ...state.workers,
        {
          id: "test-worker-updated",
          pool: "codex",
          hostname: "updated-host",
          labels: ["test"],
          repoDir: "/repos/test",
          status: "busy",
          lastHeartbeatAt: "2026-04-01T12:00:00.000Z",
          currentTaskId: "dispatch-1:task-1",
        },
      ],
    };
    saveRuntimeState(stateDir, updatedState);

    const reloaded = loadRuntimeState(stateDir);
    expect(reloaded.workers).toHaveLength(2);
    expect(reloaded.workers.find((w) => w.id === "test-worker-updated")).toBeDefined();
  });

  it("sqliteStore has required methods", () => {
    expect(sqliteStore.load).toBeDefined();
    expect(sqliteStore.save).toBeDefined();
    expect(sqliteStore.createEmpty).toBeDefined();
    expect(sqliteStore.importFromJson).toBeDefined();
  });

  it("auto-imports from JSON when DB file does not exist but JSON file exists", () => {
    const stateDir = makeTempDir();
    const jsonPath = path.join(stateDir, "runtime-state.json");

    const testState = createTestState();
    fs.writeFileSync(jsonPath, JSON.stringify(testState, null, 2));

    const imported = sqliteStore.load(stateDir);

    expect(imported.workers).toHaveLength(1);
    expect(imported.workers[0].id).toBe("test-worker-1");

    const dbPath = path.join(stateDir, "runtime-state.db");
    expect(fs.existsSync(dbPath)).toBe(true);

    const reloaded = sqliteStore.load(stateDir);
    expect(reloaded.workers[0].id).toBe("test-worker-1");
  });

  it("returns empty state when neither DB nor JSON exists", () => {
    const stateDir = makeTempDir();

    const state = sqliteStore.load(stateDir);

    expect(state.version).toBe(1);
    expect(state.workers).toHaveLength(0);
  });

  it("imports from corrupted DB by falling back to JSON if available", () => {
    const stateDir = makeTempDir();
    const dbPath = path.join(stateDir, "runtime-state.db");
    const jsonPath = path.join(stateDir, "runtime-state.json");

    fs.writeFileSync(dbPath, "not a valid sqlite database");
    const testState = createTestState();
    fs.writeFileSync(jsonPath, JSON.stringify(testState, null, 2));

    const imported = sqliteStore.load(stateDir);

    expect(imported.workers).toHaveLength(1);
    expect(imported.workers[0].id).toBe("test-worker-1");
  });

  it("imports from empty DB by falling back to JSON if available", () => {
    const stateDir = makeTempDir();
    const dbPath = path.join(stateDir, "runtime-state.db");
    const jsonPath = path.join(stateDir, "runtime-state.json");

    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    db.close();

    const testState = createTestState();
    fs.writeFileSync(jsonPath, JSON.stringify(testState, null, 2));

    const imported = sqliteStore.load(stateDir);

    expect(imported.workers).toHaveLength(1);
    expect(imported.workers[0].id).toBe("test-worker-1");
  });
});
