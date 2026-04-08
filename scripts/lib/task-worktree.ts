import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const distPath = path.join(
  repoRoot,
  "apps",
  "dispatcher",
  "dist",
  "modules",
  "server",
  "task-worktree.js",
);

await import("./dispatcher-state.js");
const tsModule = await import(pathToFileURL(distPath).href);

export const safeTaskDirName = tsModule.safeTaskDirName;
export const prepareTaskWorktree = tsModule.prepareTaskWorktree;
export const removeTaskWorktree = tsModule.removeTaskWorktree;
