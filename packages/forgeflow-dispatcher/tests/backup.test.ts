import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
  it("copies sqlite state files into a backup dir and restores them", () => {
    const stateDir = makeTempDir();
    const backupDir = makeTempDir();
    const restoreDir = makeTempDir();

    fs.writeFileSync(path.join(stateDir, "runtime-state.db"), "db");
    fs.writeFileSync(path.join(stateDir, "runtime-state.db-wal"), "wal");
    fs.writeFileSync(path.join(stateDir, "runtime-state-shadow-status.json"), "{\"status\":\"failed\"}");
    fs.writeFileSync(path.join(stateDir, "shadow-reconciler-status.json"), "{\"ok\":true}");
    fs.writeFileSync(path.join(stateDir, "shadow-cutover-drill.json"), "{\"ok\":true}");
    fs.writeFileSync(path.join(stateDir, "shadow-cutover-approval.json"), "{\"approved\":true}");
    fs.writeFileSync(path.join(stateDir, "shadow-cutover-ready.json"), "{\"ok\":true}");
    fs.writeFileSync(path.join(stateDir, "shadow-cutover-complete.json"), "{\"ok\":true}");
    fs.writeFileSync(path.join(stateDir, "shadow-cutover-revocation.json"), "{\"revoked\":true}");

    const backup = backupRuntimeState({ stateDir, backupDir });
    expect(backup.copiedFiles).toEqual([
      "runtime-state.db",
      "runtime-state.db-wal",
      "runtime-state-shadow-status.json",
      "shadow-reconciler-status.json",
      "shadow-cutover-drill.json",
      "shadow-cutover-approval.json",
      "shadow-cutover-ready.json",
      "shadow-cutover-complete.json",
      "shadow-cutover-revocation.json",
    ]);

    const restored = restoreRuntimeState({ backupDir, stateDir: restoreDir });
    expect(restored.restoredFiles).toEqual([
      "runtime-state.db",
      "runtime-state.db-wal",
      "runtime-state-shadow-status.json",
      "shadow-reconciler-status.json",
      "shadow-cutover-drill.json",
      "shadow-cutover-approval.json",
      "shadow-cutover-ready.json",
      "shadow-cutover-complete.json",
      "shadow-cutover-revocation.json",
    ]);
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
});
