import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { backupRuntimeState, restoreRuntimeState } from "../src/backup.ts";

const tmpRoots: string[] = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-dispatcher-backup-"));
  tmpRoots.push(dir);
  return dir;
}

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("backup and restore runtime state", () => {
  it("copies verified sqlite state files into a backup dir and restores them", async () => {
    const stateDir = makeTempDir();
    const backupDir = makeTempDir();
    const restoreDir = makeTempDir();

    const db = new DatabaseSync(path.join(stateDir, "runtime-state.db"));
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA wal_autocheckpoint = 0;");
    db.exec(`
      CREATE TABLE snapshots (
        revision INTEGER PRIMARY KEY AUTOINCREMENT,
        data TEXT NOT NULL,
        checksum_sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    const state = JSON.stringify({ version: 1, sequence: 7, tasks: [], events: [] });
    const checksum = crypto.createHash("sha256").update(state, "utf8").digest("hex");
    db.prepare(`
      INSERT INTO snapshots (data, checksum_sha256, created_at)
      VALUES (?, ?, ?)
    `).run(state, checksum, "2026-07-26T00:00:00.000Z");
    fs.writeFileSync(path.join(stateDir, "runtime-state-shadow-status.json"), "{\"status\":\"failed\"}");
    fs.writeFileSync(path.join(stateDir, "shadow-reconciler-status.json"), "{\"ok\":true}");
    fs.writeFileSync(path.join(stateDir, "shadow-cutover-drill.json"), "{\"ok\":true}");
    fs.writeFileSync(path.join(stateDir, "shadow-cutover-approval.json"), "{\"approved\":true}");
    fs.writeFileSync(path.join(stateDir, "shadow-cutover-ready.json"), "{\"ok\":true}");
    fs.writeFileSync(path.join(stateDir, "shadow-cutover-complete.json"), "{\"ok\":true}");
    fs.writeFileSync(path.join(stateDir, "shadow-cutover-revocation.json"), "{\"revoked\":true}");

    let backup;
    try {
      backup = await backupRuntimeState({ stateDir, backupDir });
    } finally {
      db.close();
    }
    expect(backup.copiedFiles).toEqual([
      "runtime-state.db",
      "runtime-state.db-wal",
      "runtime-state.db-shm",
      "runtime-state-shadow-status.json",
      "shadow-reconciler-status.json",
      "shadow-cutover-drill.json",
      "shadow-cutover-approval.json",
      "shadow-cutover-ready.json",
      "shadow-cutover-complete.json",
      "shadow-cutover-revocation.json",
    ]);
    expect(backup.files).toHaveLength(backup.copiedFiles.length);
    expect(backup.files.every((entry) => entry.sha256.length === 64)).toBe(true);
    expect(backup.sqliteWatermark).toMatchObject({
      integrityCheck: "ok",
      snapshotCount: 1,
      latestStateSequence: 7,
      latestSnapshotChecksumSha256: checksum,
    });
    const manifest = JSON.parse(fs.readFileSync(backup.manifestPath, "utf8"));
    expect(manifest.schemaVersion).toBe("forgeflow-runtime-state-backup/v1");
    expect(manifest.files).toEqual(backup.files);

    const restored = await restoreRuntimeState({ backupDir, stateDir: restoreDir });
    expect(restored.restoredFiles).toEqual([
      "runtime-state.db",
      "runtime-state.db-wal",
      "runtime-state.db-shm",
      "runtime-state-shadow-status.json",
      "shadow-reconciler-status.json",
      "shadow-cutover-drill.json",
      "shadow-cutover-approval.json",
      "shadow-cutover-ready.json",
      "shadow-cutover-complete.json",
      "shadow-cutover-revocation.json",
    ]);
    expect(restored.manifestVerified).toBe(true);
    expect(restored.verifiedFiles).toEqual(backup.copiedFiles);
    expect(restored.removedFiles).toEqual([]);
    expect(fs.readFileSync(path.join(restoreDir, "runtime-state-shadow-status.json"), "utf8")).toBe(
      "{\"status\":\"failed\"}",
    );
    expect(fs.readFileSync(path.join(restoreDir, "shadow-reconciler-status.json"), "utf8")).toBe(
      "{\"ok\":true}",
    );
    expect(fs.readFileSync(path.join(restoreDir, "shadow-cutover-drill.json"), "utf8")).toBe(
      "{\"ok\":true}",
    );
    expect(fs.readFileSync(path.join(restoreDir, "shadow-cutover-approval.json"), "utf8")).toBe(
      "{\"approved\":true}",
    );
    expect(fs.readFileSync(path.join(restoreDir, "shadow-cutover-ready.json"), "utf8")).toBe(
      "{\"ok\":true}",
    );
    expect(fs.readFileSync(path.join(restoreDir, "shadow-cutover-complete.json"), "utf8")).toBe(
      "{\"ok\":true}",
    );
    expect(fs.readFileSync(path.join(restoreDir, "shadow-cutover-revocation.json"), "utf8")).toBe(
      "{\"revoked\":true}",
    );
  });

  it("rejects a corrupted backup before changing the target state", async () => {
    const stateDir = makeTempDir();
    const backupDir = makeTempDir();
    const restoreDir = makeTempDir();
    fs.writeFileSync(path.join(stateDir, "runtime-state.json"), "{\"sequence\":1}");
    fs.writeFileSync(path.join(restoreDir, "runtime-state.json"), "{\"sequence\":99}");
    fs.writeFileSync(path.join(restoreDir, "runtime-state.db-wal"), "stale-wal");

    await backupRuntimeState({ stateDir, backupDir });
    fs.writeFileSync(path.join(backupDir, "runtime-state.json"), "{\"sequence\":2}");

    await expect(restoreRuntimeState({ backupDir, stateDir: restoreDir })).rejects.toThrow(
      "backup file",
    );
    expect(fs.readFileSync(path.join(restoreDir, "runtime-state.json"), "utf8")).toBe(
      "{\"sequence\":99}",
    );
    expect(fs.readFileSync(path.join(restoreDir, "runtime-state.db-wal"), "utf8")).toBe(
      "stale-wal",
    );
  });

  it("removes stale runtime files that are absent from a verified backup", async () => {
    const stateDir = makeTempDir();
    const backupDir = makeTempDir();
    const restoreDir = makeTempDir();
    fs.writeFileSync(path.join(stateDir, "runtime-state.json"), "{\"sequence\":1}");
    fs.writeFileSync(path.join(restoreDir, "runtime-state.json"), "{\"sequence\":99}");
    fs.writeFileSync(path.join(restoreDir, "runtime-state.db-wal"), "stale-wal");

    await backupRuntimeState({ stateDir, backupDir });
    const restored = await restoreRuntimeState({ backupDir, stateDir: restoreDir });

    expect(restored.manifestVerified).toBe(true);
    expect(restored.removedFiles).toEqual(["runtime-state.db-wal"]);
    expect(fs.existsSync(path.join(restoreDir, "runtime-state.db-wal"))).toBe(false);
    expect(fs.readFileSync(path.join(restoreDir, "runtime-state.json"), "utf8")).toBe(
      "{\"sequence\":1}",
    );
  });
});
