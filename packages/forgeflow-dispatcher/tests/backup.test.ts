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

    const backup = backupRuntimeState({ stateDir, backupDir });
    expect(backup.copiedFiles).toEqual([
      "runtime-state.db",
      "runtime-state.db-wal",
      "runtime-state-shadow-status.json",
    ]);

    const restored = restoreRuntimeState({ backupDir, stateDir: restoreDir });
    expect(restored.restoredFiles).toEqual([
      "runtime-state.db",
      "runtime-state.db-wal",
      "runtime-state-shadow-status.json",
    ]);
    expect(fs.readFileSync(path.join(restoreDir, "runtime-state-shadow-status.json"), "utf8")).toBe(
      "{\"status\":\"failed\"}",
    );
  });
});
