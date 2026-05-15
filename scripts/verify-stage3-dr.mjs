import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { backupRuntimeState } from "./backup-runtime-state.mjs";
import { restoreRuntimeState } from "./restore-runtime-state.mjs";

const { DatabaseSync } = await import("node:sqlite");
const WAL_SNAPSHOT_COUNT = 4;

function checksumSha256(content) {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function createRuntimeState(sequence) {
  return {
    version: 1,
    updatedAt: `2026-04-08T00:00:0${sequence}.000Z`,
    sequence,
    workers: [],
    tasks: [],
    events: [
      {
        taskId: `dr-task-${sequence}`,
        type: "created",
        at: `2026-04-08T00:00:0${sequence}.000Z`,
        payload: {
          padding: "x".repeat(128),
        },
      },
    ],
    assignments: [],
    reviews: [],
    pullRequests: [],
    dispatches: [],
    leases: [],
  };
}

function createWalBackedRuntimeStateDb(stateDir, snapshotCount) {
  fs.mkdirSync(stateDir, { recursive: true });
  const dbPath = path.join(stateDir, "runtime-state.db");
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA wal_autocheckpoint = 0;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS snapshots (
      revision INTEGER PRIMARY KEY AUTOINCREMENT,
      data TEXT NOT NULL,
      checksum_sha256 TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  let latestState = null;
  const insertSnapshot = db.prepare(`
    INSERT INTO snapshots (data, checksum_sha256, created_at)
    VALUES (?, ?, ?)
  `);
  for (let sequence = 1; sequence <= snapshotCount; sequence += 1) {
    const state = createRuntimeState(sequence);
    const content = JSON.stringify(state);
    insertSnapshot.run(content, checksumSha256(content), state.updatedAt);
    latestState = state;
  }

  const walPath = `${dbPath}-wal`;
  if (!fs.existsSync(walPath)) {
    db.close();
    throw new Error("WAL file was not created during DR verification");
  }

  return {
    db,
    latestState,
    walPath,
    walFileSize: fs.statSync(walPath).size,
  };
}

function readRestoredRuntimeState(stateDir) {
  const db = new DatabaseSync(path.join(stateDir, "runtime-state.db"), { readOnly: true });
  try {
    const integrity = db.prepare("PRAGMA integrity_check").get();
    const stats = db.prepare("SELECT COUNT(*) AS count FROM snapshots").get();
    const latest = db.prepare(`
      SELECT data, checksum_sha256
      FROM snapshots
      ORDER BY revision DESC
      LIMIT 1
    `).get();
    if (!latest) {
      throw new Error("restored runtime-state.db has no snapshots");
    }
    if (checksumSha256(latest.data) !== latest.checksum_sha256) {
      throw new Error("restored runtime-state.db snapshot checksum mismatch");
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

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-stage3-dr-"));
  const stateDir = path.join(root, "state");
  const backupDir = path.join(root, "backup");
  const writer = createWalBackedRuntimeStateDb(stateDir, WAL_SNAPSHOT_COUNT);

  let backup;
  try {
    backup = backupRuntimeState({ stateDir, backupDir });
  } finally {
    writer.db.close();
  }

  for (const fileName of ["runtime-state.db", "runtime-state.db-wal", "runtime-state.db-shm"]) {
    fs.writeFileSync(path.join(stateDir, fileName), "corrupted");
  }
  const restore = restoreRuntimeState({ backupDir, stateDir });
  const restored = readRestoredRuntimeState(stateDir);

  if (!backup.copiedFiles.includes("runtime-state.db")) {
    throw new Error("backup did not include runtime-state.db");
  }
  if (!restore.restoredFiles.includes("runtime-state.db")) {
    throw new Error("restore did not include runtime-state.db");
  }
  if (!backup.copiedFiles.includes("runtime-state.db-wal")) {
    throw new Error("backup did not include runtime-state.db-wal");
  }
  if (!restore.restoredFiles.includes("runtime-state.db-wal")) {
    throw new Error("restore did not include runtime-state.db-wal");
  }
  if (restored.integrityCheck !== "ok") {
    throw new Error(`restored runtime-state.db integrity check failed: ${restored.integrityCheck}`);
  }
  if (restored.snapshotCount !== WAL_SNAPSHOT_COUNT) {
    throw new Error(`restored snapshot count mismatch: ${restored.snapshotCount}`);
  }
  if (restored.restoredState.sequence !== writer.latestState.sequence) {
    throw new Error(`restored latest sequence mismatch: ${restored.restoredState.sequence}`);
  }

  console.log(JSON.stringify({
    ok: true,
    root,
    walIncluded: backup.copiedFiles.includes("runtime-state.db-wal"),
    walFileSize: writer.walFileSize,
    copiedFiles: backup.copiedFiles,
    restoredFiles: restore.restoredFiles,
    manifestPath: backup.manifestPath,
    integrityCheck: restored.integrityCheck,
    snapshotCount: restored.snapshotCount,
    restoredState: restored.restoredState,
  }, null, 2));
}

main();
