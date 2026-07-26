import { restoreRuntimeState } from "./runtime-state-backup-core.mjs";

export { restoreRuntimeState };

if (import.meta.url === `file://${process.argv[1]}`) {
  const backupDir = process.argv[2];
  const stateDir = process.argv[3];
  if (!backupDir || !stateDir) {
    throw new Error("usage: node scripts/restore-runtime-state.mjs <backupDir> <stateDir>");
  }
  const result = await restoreRuntimeState({ backupDir, stateDir });
  console.log(JSON.stringify(result, null, 2));
}
