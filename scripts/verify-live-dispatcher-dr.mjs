import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { backupRuntimeState } from "./backup-runtime-state.mjs";
import { restoreRuntimeState } from "./restore-runtime-state.mjs";
import { startDispatcherServer } from "./lib/dispatcher-server.js";

const { DatabaseSync } = await import("node:sqlite");

const LIVE_EVENT_COUNT = 16;
const CHILD_START_TIMEOUT_MS = 30_000;
const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");

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

function parseChildServerOutput(output) {
  try {
    return JSON.parse(output);
  } catch {
    return null;
  }
}

function waitForProcessExit(child) {
  return new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

function spawnDispatcherChild(stateDir) {
  return spawn(process.execPath, [
    "scripts/run-dispatcher-server.js",
    "--host",
    "127.0.0.1",
    "--port",
    "0",
    "--state-dir",
    stateDir,
    "--persistence-backend",
    "sqlite",
  ], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DISPATCHER_AUTH_MODE: "open",
      RUNTIME_STATE_BACKEND: "sqlite",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function waitForDispatcherChild(child) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`dispatcher child did not start within ${CHILD_START_TIMEOUT_MS}ms: ${stderr}`));
    }, CHILD_START_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      const payload = parseChildServerOutput(stdout);
      if (!payload || settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve({
        child,
        baseUrl: payload.baseUrl,
        stateDir: payload.stateDir,
        stderr: () => stderr,
      });
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      reject(new Error(`dispatcher child exited before listening: code=${code} signal=${signal} stderr=${stderr}`));
    });
  });
}

function startDispatcherChild(stateDir) {
  const child = spawnDispatcherChild(stateDir);
  return waitForDispatcherChild(child);
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
  const corruptedFiles = [];
  for (const fileName of ["runtime-state.db", "runtime-state.db-wal", "runtime-state.db-shm"]) {
    const target = path.join(stateDir, fileName);
    if (fs.existsSync(target)) {
      fs.writeFileSync(target, "corrupted");
      corruptedFiles.push(fileName);
    }
  }
  return corruptedFiles;
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
  const corruptedFiles = corruptRuntimeFiles(stateDir);
  const restore = restoreRuntimeState({ backupDir, stateDir });
  const restored = readRestoredRuntimeState(stateDir);
  assertRestoredState(restored, taskId);
  return {
    restore,
    restored,
    diskCorruption: {
      corruptionInjected: corruptedFiles.length > 0,
      corruptedFiles,
      restoredIntegrityCheck: restored.integrityCheck,
      restoredSnapshotCount: restored.snapshotCount,
    },
  };
}

async function runCrashRestartDrill(root) {
  const stateDir = path.join(root, "crash-state");
  const backupDir = path.join(root, "crash-backup");
  const recoveredStateDir = path.join(root, "crash-recovered-state");
  const childInstance = await startDispatcherChild(stateDir);
  let recoveredInstance = null;
  let crashExit = null;
  try {
    const liveBackup = await backupLiveState(childInstance, stateDir, backupDir);
    childInstance.child.kill("SIGKILL");
    crashExit = await waitForProcessExit(childInstance.child);

    restoreRuntimeState({ backupDir, stateDir: recoveredStateDir });
    const restored = readRestoredRuntimeState(recoveredStateDir);
    assertRestoredState(restored, liveBackup.taskId);

    recoveredInstance = await startDispatcherServer({ host: "127.0.0.1", port: 0, stateDir: recoveredStateDir });
    const recoveredSnapshot = await requestJson(recoveredInstance.baseUrl, "GET", "/api/dashboard/snapshot");
    if (!recoveredSnapshot.tasks.some((task) => task.id === liveBackup.taskId)) {
      throw new Error(`recovered dispatcher snapshot does not contain task ${liveBackup.taskId}`);
    }

    return {
      crashProcessSignal: crashExit.signal,
      crashProcessExitCode: crashExit.code,
      restoredDispatcherRestarted: true,
      recoveredTaskCount: recoveredSnapshot.tasks.length,
      recoveredEventCount: recoveredSnapshot.events.length,
      recoveredIntegrityCheck: restored.integrityCheck,
      replacementStateDir: recoveredStateDir,
    };
  } finally {
    if (!crashExit) {
      childInstance.child.kill("SIGKILL");
      await waitForProcessExit(childInstance.child);
    }
    if (recoveredInstance) {
      await recoveredInstance.close();
    }
  }
}

async function runMultiNodeRestoreDrill(root, backupDir, taskId) {
  const nodeNames = ["node-a", "node-b"];
  const instances = [];
  const nodes = [];
  try {
    for (const nodeName of nodeNames) {
      const nodeStateDir = path.join(root, `${nodeName}-state`);
      const restore = restoreRuntimeState({ backupDir, stateDir: nodeStateDir });
      const restored = readRestoredRuntimeState(nodeStateDir);
      assertRestoredState(restored, taskId);
      const instance = await startDispatcherServer({ host: "127.0.0.1", port: 0, stateDir: nodeStateDir });
      instances.push(instance);
      const snapshot = await requestJson(instance.baseUrl, "GET", "/api/dashboard/snapshot");
      nodes.push({
        node: nodeName,
        stateDir: nodeStateDir,
        dispatcherRestarted: true,
        integrityCheck: restored.integrityCheck,
        snapshotCount: restored.snapshotCount,
        taskCount: snapshot.tasks.length,
        eventCount: snapshot.events.length,
        restoredFiles: restore.restoredFiles,
      });
    }

    return {
      nodeCount: nodes.length,
      nodes,
      consistentTaskCounts: new Set(nodes.map((node) => node.taskCount)).size === 1,
      consistentEventCounts: new Set(nodes.map((node) => node.eventCount)).size === 1,
    };
  } finally {
    await Promise.all(instances.map((instance) => instance.close()));
  }
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

    const { restore, restored, diskCorruption } = restoreBackedUpState(stateDir, backupDir, liveBackup.taskId);
    const crashRestart = await runCrashRestartDrill(root);
    const multiNodeRestore = await runMultiNodeRestoreDrill(root, backupDir, liveBackup.taskId);

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
      crashRestart,
      hostFailure: {
        simulatedHostLost: crashRestart.crashProcessSignal === "SIGKILL",
        replacementDispatcherRestarted: crashRestart.restoredDispatcherRestarted,
        recoveredIntegrityCheck: crashRestart.recoveredIntegrityCheck,
        recoveredTaskCount: crashRestart.recoveredTaskCount,
        recoveredEventCount: crashRestart.recoveredEventCount,
        replacementStateDir: crashRestart.replacementStateDir,
      },
      diskCorruption,
      multiNodeRestore,
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
