import fs from "node:fs";
import path from "node:path";

const FILES = [
  "runtime-state.db",
  "runtime-state.db-wal",
  "runtime-state.db-shm",
  "runtime-state.json",
  "runtime-state-shadow-status.json",
];

export function backupRuntimeState({ stateDir, backupDir }: { stateDir: string; backupDir: string }) {
  fs.mkdirSync(backupDir, { recursive: true });
  const copiedFiles: string[] = [];

  for (const name of FILES) {
    const source = path.join(stateDir, name);
    if (!fs.existsSync(source)) {
      continue;
    }
    const target = path.join(backupDir, name);
    fs.copyFileSync(source, target);
    copiedFiles.push(name);
  }

  const manifest = {
    backedUpAt: new Date().toISOString(),
    stateDir,
    copiedFiles,
  };
  const manifestPath = path.join(backupDir, `${manifest.backedUpAt.replace(/[:]/g, "-")}-manifest.json`);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    manifestPath,
    copiedFiles,
  };
}

export function restoreRuntimeState({ backupDir, stateDir }: { backupDir: string; stateDir: string }) {
  fs.mkdirSync(stateDir, { recursive: true });
  const restoredFiles: string[] = [];

  for (const name of FILES) {
    const source = path.join(backupDir, name);
    if (!fs.existsSync(source)) {
      continue;
    }
    const target = path.join(stateDir, name);
    fs.copyFileSync(source, target);
    restoredFiles.push(name);
  }

  return {
    restoredFiles,
  };
}
