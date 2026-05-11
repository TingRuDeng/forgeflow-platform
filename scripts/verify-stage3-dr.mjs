import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { backupRuntimeState } from "./backup-runtime-state.mjs";
import { restoreRuntimeState } from "./restore-runtime-state.mjs";

const { DatabaseSync } = await import("node:sqlite");

function checksumSha256(content) {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function createRuntimeState() {
  return {
    version: 1,
    updatedAt: "2026-04-08T00:00:00.000Z",
    sequence: 1,
    workers: [],
    tasks: [],
    events: [],
    assignments: [],
    reviews: [],
    pullRequests: [],
    dispatches: [],
    leases: [],
  };
}

function writeRuntimeStateDb(stateDir, state) {
  fs.mkdirSync(stateDir, { recursive: true });
  const db = new DatabaseSync(path.join(stateDir, "runtime-state.db"));
  try {
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec(`
      CREATE TABLE IF NOT EXISTS snapshots (
        revision INTEGER PRIMARY KEY AUTOINCREMENT,
        data TEXT NOT NULL,
        checksum_sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    const content = JSON.stringify(state);
    db.prepare(`
      INSERT INTO snapshots (data, checksum_sha256, created_at)
      VALUES (?, ?, ?)
    `).run(content, checksumSha256(content), state.updatedAt);
  } finally {
    db.close();
  }
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
  const originalState = createRuntimeState();

  writeRuntimeStateDb(stateDir, originalState);
  const backup = backupRuntimeState({ stateDir, backupDir });
  fs.writeFileSync(path.join(stateDir, "runtime-state.db"), "corrupted");

  const restore = restoreRuntimeState({ backupDir, stateDir });
  const restored = readRestoredRuntimeState(stateDir);

  if (!backup.copiedFiles.includes("runtime-state.db")) {
    throw new Error("backup did not include runtime-state.db");
  }
  if (!restore.restoredFiles.includes("runtime-state.db")) {
    throw new Error("restore did not include runtime-state.db");
  }
  if (restored.integrityCheck !== "ok") {
    throw new Error(`restored runtime-state.db integrity check failed: ${restored.integrityCheck}`);
  }

  console.log(JSON.stringify({
    ok: true,
    root,
    copiedFiles: backup.copiedFiles,
    restoredFiles: restore.restoredFiles,
    manifestPath: backup.manifestPath,
    integrityCheck: restored.integrityCheck,
    snapshotCount: restored.snapshotCount,
    restoredState: restored.restoredState,
  }, null, 2));
}

main();
