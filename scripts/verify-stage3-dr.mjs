import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { backupRuntimeState } from "./backup-runtime-state.mjs";
import { restoreRuntimeState } from "./restore-runtime-state.mjs";

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-stage3-dr-"));
  const stateDir = path.join(root, "state");
  const backupDir = path.join(root, "backup");
  fs.mkdirSync(stateDir, { recursive: true });

  const originalContent = "stage3-runtime-state";
  fs.writeFileSync(path.join(stateDir, "runtime-state.db"), originalContent);
  fs.writeFileSync(path.join(stateDir, "runtime-state.db-wal"), "wal");

  const backup = backupRuntimeState({ stateDir, backupDir });
  fs.writeFileSync(path.join(stateDir, "runtime-state.db"), "corrupted");

  const restore = restoreRuntimeState({ backupDir, stateDir });
  const restoredContent = fs.readFileSync(path.join(stateDir, "runtime-state.db"), "utf8");

  if (!backup.copiedFiles.includes("runtime-state.db")) {
    throw new Error("backup did not include runtime-state.db");
  }
  if (!restore.restoredFiles.includes("runtime-state.db")) {
    throw new Error("restore did not include runtime-state.db");
  }
  if (restoredContent !== originalContent) {
    throw new Error("restored runtime-state.db content mismatch");
  }

  console.log(JSON.stringify({
    ok: true,
    root,
    copiedFiles: backup.copiedFiles,
    restoredFiles: restore.restoredFiles,
    manifestPath: backup.manifestPath,
  }, null, 2));
}

main();
