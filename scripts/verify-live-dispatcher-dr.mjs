import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { backupRuntimeState } from "./backup-runtime-state.mjs";
import { restoreRuntimeState } from "./restore-runtime-state.mjs";
import { startDispatcherServer } from "./lib/dispatcher-server.js";

const { DatabaseSync } = await import("node:sqlite");

const LIVE_EVENT_COUNT = 16;

function setTemporaryEnv(values) {
  const previous = new Map();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return () => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

async function requestJson(baseUrl, method, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${method} ${pathname} failed ${response.status}: ${text}`);
  }
  return json;
}

function createDispatchPayload() {
  return {
    repo: "local/live-drill",
    defaultBranch: "main",
    requestedBy: "stage3-live-dr",
    tasks: [{
      id: "live-dr-task",
      title: "验证 live dispatcher DR 演练",
      pool: "codex",
      allowedPaths: ["apps/dispatcher/**", "scripts/**"],
      acceptance: ["恢复后的 SQLite 快照可查询"],
      dependsOn: [],
      branchName: "codex/live-dispatcher-dr-drill",
      verification: { mode: "run" },
    }],
    packages: [{
      taskId: "live-dr-task",
      assignment: {
        taskId: "live-dr-task",
        workerId: "placeholder",
        pool: "codex",
        status: "assigned",
        branchName: "codex/live-dispatcher-dr-drill",
        allowedPaths: ["apps/dispatcher/**", "scripts/**"],
        commands: { test: "pnpm verify:stage3:live" },
        repo: "local/live-drill",
        defaultBranch: "main",
      },
      workerPrompt: "你是 stage3 live DR drill worker。",
      contextMarkdown: "# Live DR Drill",
    }],
  };
}

async function startLiveWrites(baseUrl) {
  await requestJson(baseUrl, "POST", "/api/workers/register", {
    workerId: "codex-live-dr",
    pool: "codex",
    hostname: "localhost",
    labels: ["live-drill"],
    repoDir: "/tmp/forgeflow-live-drill",
  });
  const dispatch = await requestJson(baseUrl, "POST", "/api/dispatches", createDispatchPayload());
  const taskId = dispatch.taskIds[0];
  const eventPromises = Array.from({ length: LIVE_EVENT_COUNT }, (_, index) => requestJson(
    baseUrl,
    "POST",
    "/api/workers/codex-live-dr/events",
    {
      type: "progress_reported",
      taskId,
      at: `2026-06-08T00:00:${String(index).padStart(2, "0")}.000Z`,
      payload: { sequence: index + 1 },
    },
  ));
  return { taskId, eventPromises };
}

function openWalKeeper(stateDir) {
  const db = new DatabaseSync(path.join(stateDir, "runtime-state.db"));
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA wal_autocheckpoint = 0;");
  return db;
}

function readRestoredRuntimeState(stateDir) {
  const db = new DatabaseSync(path.join(stateDir, "runtime-state.db"), { readOnly: true });
  try {
    const integrity = db.prepare("PRAGMA integrity_check").get();
    const stats = db.prepare("SELECT COUNT(*) AS count FROM snapshots").get();
    const latest = db.prepare(`
      SELECT data
      FROM snapshots
      ORDER BY revision DESC
      LIMIT 1
    `).get();
    if (!latest) {
      throw new Error("restored live runtime-state.db has no snapshots");
    }
    return {
      integrityCheck: integrity.integrity_check,
      snapshotCount: Number(stats.count),
      restoredState: JSON.parse(latest.data),
    };
  } finally {
    db.close();
  }
}

function corruptRuntimeFiles(stateDir) {
  for (const fileName of ["runtime-state.db", "runtime-state.db-wal", "runtime-state.db-shm"]) {
    const target = path.join(stateDir, fileName);
    if (fs.existsSync(target)) {
      fs.writeFileSync(target, "corrupted");
    }
  }
}

function assertRestoredState(restored, taskId) {
  if (restored.integrityCheck !== "ok") {
    throw new Error(`restored live runtime-state.db integrity check failed: ${restored.integrityCheck}`);
  }
  if (restored.snapshotCount < 2) {
    throw new Error(`restored live snapshot count too low: ${restored.snapshotCount}`);
  }
  if (!restored.restoredState.tasks.some((task) => task.id === taskId)) {
    throw new Error(`restored live state does not contain task ${taskId}`);
  }
}

async function backupLiveState(instance, stateDir, backupDir) {
  let walKeeper = null;
  try {
    const live = await startLiveWrites(instance.baseUrl);
    walKeeper = openWalKeeper(stateDir);
    // 备份发生在 live server 仍运行且事件写入 burst 已发起之后，用来覆盖真实 HTTP 写入压力下的 WAL 文件复制路径。
    const backup = backupRuntimeState({ stateDir, backupDir });
    const eventResults = await Promise.all(live.eventPromises);
    const metrics = await requestJson(instance.baseUrl, "GET", "/api/metrics");
    return {
      taskId: live.taskId,
      backup,
      eventResults,
      metrics,
    };
  } finally {
    if (walKeeper) {
      walKeeper.close();
    }
  }
}

function restoreBackedUpState(stateDir, backupDir, taskId) {
  corruptRuntimeFiles(stateDir);
  const restore = restoreRuntimeState({ backupDir, stateDir });
  const restored = readRestoredRuntimeState(stateDir);
  assertRestoredState(restored, taskId);
  return {
    restore,
    restored,
  };
}

async function runLiveDrill() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-live-dispatcher-dr-"));
  const stateDir = path.join(root, "state");
  const backupDir = path.join(root, "backup");
  const restoreEnv = setTemporaryEnv({
    DISPATCHER_AUTH_MODE: "open",
    DISPATCHER_READ_ONLY_MODE: null,
    RUNTIME_STATE_BACKEND: "sqlite",
  });
  let instance = null;
  let baseUrl = null;

  try {
    instance = await startDispatcherServer({ host: "127.0.0.1", port: 0, stateDir });
    baseUrl = instance.baseUrl;
    const liveBackup = await backupLiveState(instance, stateDir, backupDir);

    await instance.close();
    instance = null;

    const { restore, restored } = restoreBackedUpState(stateDir, backupDir, liveBackup.taskId);

    return {
      ok: true,
      root,
      baseUrl,
      backupDuringServerOpen: true,
      liveWriteAttemptCount: LIVE_EVENT_COUNT,
      liveWriteSuccessCount: liveBackup.eventResults.length,
      copiedFiles: liveBackup.backup.copiedFiles,
      restoredFiles: restore.restoredFiles,
      manifestPath: liveBackup.backup.manifestPath,
      integrityCheck: restored.integrityCheck,
      snapshotCount: restored.snapshotCount,
      restoredTaskCount: restored.restoredState.tasks.length,
      restoredEventCount: restored.restoredState.events.length,
      metrics: liveBackup.metrics,
    };
  } finally {
    if (instance) {
      await instance.close();
    }
    restoreEnv();
  }
}

const result = await runLiveDrill();
console.log(JSON.stringify(result, null, 2));
