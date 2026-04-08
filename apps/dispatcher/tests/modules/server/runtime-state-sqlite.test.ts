import crypto from "node:crypto";
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
    leases: [],
  };
}

function readSnapshotState(stateDir: string): {
  journalMode: string;
  count: number;
  minRevision: number;
  maxRevision: number;
  latest:
    | {
        revision: number;
        data: string;
        checksum_sha256: string;
        created_at: string;
      }
    | undefined;
} {
  const db = new DatabaseSync(path.join(stateDir, "runtime-state.db"), { readOnly: true });

  try {
    const journalMode = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
    const stats = db.prepare(`
      SELECT
        COUNT(*) AS count,
        MIN(revision) AS minRevision,
        MAX(revision) AS maxRevision
      FROM snapshots
    `).get() as { count: number; minRevision: number; maxRevision: number };
    const latest = db
      .prepare(
        "SELECT revision, data, checksum_sha256, created_at FROM snapshots ORDER BY revision DESC LIMIT 1",
      )
      .get() as
      | {
          revision: number;
          data: string;
          checksum_sha256: string;
          created_at: string;
        }
      | undefined;

    return {
      journalMode: journalMode.journal_mode,
      count: stats.count,
      minRevision: stats.minRevision,
      maxRevision: stats.maxRevision,
      latest,
    };
  } finally {
    db.close();
  }
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

  it("throws a descriptive error when the latest snapshot payload is malformed", () => {
    const stateDir = makeTempDir();
    const dbPath = path.join(stateDir, "runtime-state.db");
    const malformedSnapshot = "{broken";
    fs.mkdirSync(stateDir, { recursive: true });

    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS snapshots (
        revision INTEGER PRIMARY KEY AUTOINCREMENT,
        data TEXT NOT NULL,
        checksum_sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    db.prepare(`
      INSERT INTO snapshots (data, checksum_sha256, created_at)
      VALUES (?, ?, ?)
    `).run(
      malformedSnapshot,
      crypto.createHash("sha256").update(malformedSnapshot, "utf8").digest("hex"),
      "2026-04-08T00:00:00.000Z",
    );
    db.close();

    expect(() => loadRuntimeState(stateDir)).toThrow(/failed to parse snapshot at revision/i);
  });

  it("throws a descriptive error when JSON import content is malformed", () => {
    const stateDir = makeTempDir();

    expect(() => sqliteStore.importFromJson(stateDir, "{broken")).toThrow(/failed to parse JSON import content/i);
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

  it("appends snapshot revisions and preserves history on save", () => {
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

    const snapshotState = readSnapshotState(stateDir);
    expect(snapshotState.journalMode).toBe("wal");
    expect(snapshotState.count).toBe(2);
    expect(snapshotState.minRevision).toBe(1);
    expect(snapshotState.maxRevision).toBe(2);
    expect(snapshotState.latest?.revision).toBe(2);
    expect(snapshotState.latest).toBeDefined();
    expect(snapshotState.latest?.checksum_sha256).toBe(
      crypto.createHash("sha256").update(snapshotState.latest?.data ?? "", "utf8").digest("hex"),
    );
  });

  it("throws when the snapshot table is empty", () => {
    const stateDir = makeTempDir();
    const dbPath = path.join(stateDir, "runtime-state.db");

    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS snapshots (
        revision INTEGER PRIMARY KEY AUTOINCREMENT,
        data TEXT NOT NULL,
        checksum_sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    db.close();

    expect(() => loadRuntimeState(stateDir)).toThrow(/failed to load runtime-state\.db|snapshots/i);
  });

  it("throws when the latest snapshot checksum does not match", () => {
    const stateDir = makeTempDir();
    const state = createTestState();

    saveRuntimeState(stateDir, state);

    const db = new DatabaseSync(path.join(stateDir, "runtime-state.db"));
    db.prepare("UPDATE snapshots SET data = data || 'corrupted' WHERE revision = 1").run();
    db.close();

    expect(() => loadRuntimeState(stateDir)).toThrow(/checksum mismatch|failed to load runtime-state\.db/i);
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

  it("loads the latest snapshot without requiring write access to the sqlite directory", () => {
    const stateDir = makeTempDir();
    const state = createTestState();

    saveRuntimeState(stateDir, state);

    const dbPath = path.join(stateDir, "runtime-state.db");
    const walPath = `${dbPath}-wal`;
    const shmPath = `${dbPath}-shm`;
    if (fs.existsSync(walPath)) {
      fs.unlinkSync(walPath);
    }
    if (fs.existsSync(shmPath)) {
      fs.unlinkSync(shmPath);
    }

    fs.chmodSync(dbPath, 0o444);
    fs.chmodSync(stateDir, 0o555);

    try {
      const reloaded = loadRuntimeState(stateDir);
      expect(reloaded.workers[0].id).toBe("test-worker-1");
    } finally {
      fs.chmodSync(stateDir, 0o755);
      fs.chmodSync(dbPath, 0o644);
    }
  });

  it("throws for a corrupted db by default and rescues from JSON only with the explicit env switch", () => {
    const stateDir = makeTempDir();
    const dbPath = path.join(stateDir, "runtime-state.db");
    const jsonPath = path.join(stateDir, "runtime-state.json");

    fs.writeFileSync(dbPath, "not a valid sqlite database");
    const testState = createTestState();
    fs.writeFileSync(jsonPath, JSON.stringify(testState, null, 2));

    const originalEnv = process.env.FORGEFLOW_ALLOW_STATE_FALLBACK_JSON;
    delete process.env.FORGEFLOW_ALLOW_STATE_FALLBACK_JSON;

    expect(() => sqliteStore.load(stateDir)).toThrow(/failed to load runtime-state\.db/i);

    process.env.FORGEFLOW_ALLOW_STATE_FALLBACK_JSON = "1";
    const imported = sqliteStore.load(stateDir);

    expect(imported.workers).toHaveLength(1);
    expect(imported.workers[0].id).toBe("test-worker-1");

    if (originalEnv !== undefined) {
      process.env.FORGEFLOW_ALLOW_STATE_FALLBACK_JSON = originalEnv;
    } else {
      delete process.env.FORGEFLOW_ALLOW_STATE_FALLBACK_JSON;
    }
  });
});
