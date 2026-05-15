import fs from "node:fs";
import path from "node:path";

const FILES = [
  "runtime-state.db",
  "runtime-state.db-wal",
  "runtime-state.db-shm",
  "runtime-state.json",
  "runtime-state-shadow-status.json",
];

export function restoreRuntimeState({ backupDir, stateDir }) {
  fs.mkdirSync(stateDir, { recursive: true });
  const restoredFiles = [];

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

if (import.meta.url === `file://${process.argv[1]}`) {
  const backupDir = process.argv[2];
  const stateDir = process.argv[3];
  if (!backupDir || !stateDir) {
    throw new Error("usage: node scripts/restore-runtime-state.mjs <backupDir> <stateDir>");
  }
  const result = restoreRuntimeState({ backupDir, stateDir });
  console.log(JSON.stringify(result, null, 2));
}
