import fs from "node:fs";
import path from "node:path";

const FILES = [
  "runtime-state.db",
  "runtime-state.db-wal",
  "runtime-state.db-shm",
  "runtime-state.json",
  "runtime-state-shadow-status.json",
];

export function backupRuntimeState({ stateDir, backupDir }) {
  fs.mkdirSync(backupDir, { recursive: true });
  const copiedFiles = [];

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

if (import.meta.url === `file://${process.argv[1]}`) {
  const stateDir = process.argv[2];
  const backupDir = process.argv[3] ?? path.join(stateDir, "backups");
  if (!stateDir) {
    throw new Error("usage: node scripts/backup-runtime-state.mjs <stateDir> [backupDir]");
  }
  const result = backupRuntimeState({ stateDir, backupDir });
  console.log(JSON.stringify(result, null, 2));
}
