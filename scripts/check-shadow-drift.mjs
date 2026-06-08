#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");
const shadowDistPath = path.join(repoRoot, "apps", "dispatcher", "dist", "modules", "server", "runtime-state-shadow.js");

function parseArgs(argv) {
  const stateDir = argv[0];
  if (!stateDir || argv.length > 1) {
    throw new Error("usage: node scripts/check-shadow-drift.mjs <stateDir>");
  }
  return {
    stateDir,
  };
}

async function loadDispatcherModules() {
  const stateModule = await import("./lib/dispatcher-state.js");
  const shadowModule = await import(pathToFileURL(shadowDistPath).href);
  return {
    stateModule,
    shadowModule,
  };
}

async function checkShadowDrift(stateDir) {
  const { stateModule, shadowModule } = await loadDispatcherModules();
  const shadowMode = shadowModule.getRuntimeStateShadowMode();
  const postgresUrl = process.env.DISPATCHER_POSTGRES_URL?.trim();
  const state = shadowMode === "disabled" || !postgresUrl
    ? stateModule.createEmptyRuntimeState()
    : stateModule.loadRuntimeState(stateDir);
  const health = await shadowModule.readRuntimeStateShadowHealth(state);
  const drift = shadowModule.summarizeRuntimeStateShadowDrift(health);
  return {
    ok: drift.status !== "drifted",
    stateDir,
    drift,
    health,
  };
}

function printResult(result) {
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 2;
  }
}

async function main() {
  const { stateDir } = parseArgs(process.argv.slice(2));
  printResult(await checkShadowDrift(stateDir));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

export { parseArgs };
