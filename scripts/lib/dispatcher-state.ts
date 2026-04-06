import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "./logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const distPath = path.join(repoRoot, "apps", "dispatcher", "dist", "modules", "server", "runtime-state.js");
const DISPATCHER_DIST_BUILT = Symbol.for("forgeflow.dispatcher.state.distBuilt");
const buildState = globalThis as unknown as Record<string | symbol, boolean>;

if (!buildState[DISPATCHER_DIST_BUILT]) {
  logger.info({ event: "dispatcher_build_triggered", message: "Building apps/dispatcher to ensure fresh dist" });
  execSync("pnpm --filter @forgeflow/dispatcher build", {
    cwd: repoRoot,
    stdio: ["ignore", "ignore", "inherit"],
  });
  buildState[DISPATCHER_DIST_BUILT] = true;
}

const tsModule = await import(distPath);

export const createEmptyRuntimeState = tsModule.createEmptyRuntimeState;
export const loadRuntimeState = tsModule.loadRuntimeState;
export const saveRuntimeState = tsModule.saveRuntimeState;
export const reconcileRuntimeState = tsModule.reconcileRuntimeState;
export const registerWorker = tsModule.registerWorker;
export const heartbeatWorker = tsModule.heartbeatWorker;
export const createDispatch = tsModule.createDispatch;
export const getAssignedTaskForWorker = tsModule.getAssignedTaskForWorker;
export const claimAssignedTaskForWorker = tsModule.claimAssignedTaskForWorker;
export const beginTaskForWorker = tsModule.beginTaskForWorker;
export const recordWorkerResult = tsModule.recordWorkerResult;
export const recordReviewDecision = tsModule.recordReviewDecision;
export const buildDashboardSnapshot = tsModule.buildDashboardSnapshot;
