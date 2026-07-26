import path from "node:path";

import { backupRuntimeState } from "./runtime-state-backup-core.mjs";

export { backupRuntimeState };

if (import.meta.url === `file://${process.argv[1]}`) {
  const stateDir = process.argv[2];
  const backupDir = process.argv[3] ?? path.join(
    stateDir,
    "backups",
    new Date().toISOString().replace(/[:]/g, "-"),
  );
  if (!stateDir) {
    throw new Error("usage: node scripts/backup-runtime-state.mjs <stateDir> [backupDir]");
  }
  const result = await backupRuntimeState({ stateDir, backupDir });
  console.log(JSON.stringify(result, null, 2));
}
