import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "./logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const distPath = path.join(repoRoot, "apps", "dispatcher", "dist", "modules", "server", "runtime-state.js");
const buildLockPath = path.join(
  os.tmpdir(),
  `forgeflow-dispatcher-dist-build-${createHash("sha1").update(repoRoot).digest("hex").slice(0, 12)}`,
);
const DISPATCHER_DIST_BUILT = Symbol.for("forgeflow.dispatcher.state.distBuilt");
const buildState = globalThis as unknown as Record<string | symbol, boolean>;
const BUILD_LOCK_TIMEOUT_MS = 120_000;
const BUILD_LOCK_STALE_MS = 300_000;

function sleepMs(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireBuildLock(): () => void {
  const startedAt = Date.now();

  while (true) {
    try {
      fs.mkdirSync(buildLockPath);
      return () => {
        fs.rmSync(buildLockPath, { recursive: true, force: true });
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw error;
      }

      try {
        const stat = fs.statSync(buildLockPath);
        if (Date.now() - stat.mtimeMs > BUILD_LOCK_STALE_MS) {
          fs.rmSync(buildLockPath, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }

      if (Date.now() - startedAt > BUILD_LOCK_TIMEOUT_MS) {
        throw new Error(`Timed out waiting for dispatcher dist build lock: ${buildLockPath}`);
      }
      sleepMs(100);
    }
  }
}

if (!buildState[DISPATCHER_DIST_BUILT]) {
  const releaseBuildLock = acquireBuildLock();
  try {
    logger.info({ event: "dispatcher_build_triggered", message: "Building apps/dispatcher to ensure fresh dist" });
    execSync("pnpm --filter @forgeflow/dispatcher build", {
      cwd: repoRoot,
      stdio: ["ignore", "ignore", "inherit"],
    });
    buildState[DISPATCHER_DIST_BUILT] = true;
  } finally {
    releaseBuildLock();
  }
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
