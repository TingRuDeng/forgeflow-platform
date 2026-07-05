#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");
const shadowDistPath = path.join(repoRoot, "apps", "dispatcher", "dist", "modules", "server", "runtime-state-shadow.js");
const MAX_MISMATCHES_ENV = "DISPATCHER_SHADOW_DRIFT_MAX_MISMATCHES";
const MAX_DELTA_ENV = "DISPATCHER_SHADOW_DRIFT_MAX_DELTA";
const AUTO_RECONCILE_ENV = "DISPATCHER_SHADOW_DRIFT_AUTO_RECONCILE";
const RECORD_ALERT_ENV = "DISPATCHER_SHADOW_DRIFT_RECORD_ALERT";
const REQUIRE_CONFIGURED_ENV = "DISPATCHER_SHADOW_DRIFT_REQUIRE_CONFIGURED";
const REQUIRE_PRIMARY_BACKEND_ENV = "DISPATCHER_PRIMARY_BACKEND_REQUIRE_CONFIGURED";
const RUNTIME_STATE_BACKEND_ENV = "RUNTIME_STATE_BACKEND";
const PRIMARY_POSTGRES_URL_ENV = "DISPATCHER_PRIMARY_POSTGRES_URL";

function parseNonNegativeInteger(value, label) {
  const parsed = Number(value);
  if (value === undefined || value === "" || !Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative number`);
  }
  return Math.floor(parsed);
}

function parseBooleanEnv(value) {
  return value === "1" || value === "true" || value === "yes";
}

function parseArgs(argv) {
  const stateDir = argv[0];
  if (!stateDir) {
    throw new Error("usage: node scripts/check-shadow-drift.mjs <stateDir> [--reconcile] [--record-alert] [--require-configured] [--require-primary-backend] [--max-mismatches n] [--max-delta n]");
  }
  const options = {
    stateDir,
    reconcile: false,
    recordAlert: false,
    requireConfigured: false,
    requirePrimaryBackend: false,
    maxMismatchCount: undefined,
    maxAbsoluteDelta: undefined,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--reconcile") {
      options.reconcile = true;
      continue;
    }
    if (arg === "--record-alert") {
      options.recordAlert = true;
      continue;
    }
    if (arg === "--require-configured") {
      options.requireConfigured = true;
      continue;
    }
    if (arg === "--require-primary-backend") {
      options.requirePrimaryBackend = true;
      continue;
    }
    if (arg === "--max-mismatches" || arg === "--max-delta") {
      const rawValue = argv[index + 1];
      const value = parseNonNegativeInteger(rawValue, arg);
      if (arg === "--max-mismatches") {
        options.maxMismatchCount = value;
      } else {
        options.maxAbsoluteDelta = value;
      }
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return {
    ...options,
    reconcile: options.reconcile || parseBooleanEnv(process.env[AUTO_RECONCILE_ENV]),
    recordAlert: options.recordAlert || parseBooleanEnv(process.env[RECORD_ALERT_ENV]),
    requireConfigured: options.requireConfigured || parseBooleanEnv(process.env[REQUIRE_CONFIGURED_ENV]),
    requirePrimaryBackend: options.requirePrimaryBackend || parseBooleanEnv(process.env[REQUIRE_PRIMARY_BACKEND_ENV]),
    maxMismatchCount: options.maxMismatchCount ?? (
      process.env[MAX_MISMATCHES_ENV] ? parseNonNegativeInteger(process.env[MAX_MISMATCHES_ENV], MAX_MISMATCHES_ENV) : undefined
    ),
    maxAbsoluteDelta: options.maxAbsoluteDelta ?? (
      process.env[MAX_DELTA_ENV] ? parseNonNegativeInteger(process.env[MAX_DELTA_ENV], MAX_DELTA_ENV) : undefined
    ),
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

function buildReconciliationStatus(requested, attempted, reason) {
  return { requested, attempted, reason };
}

function buildPrimaryBackendStatus(requirePrimaryBackend) {
  if (!requirePrimaryBackend) {
    return { required: false, ready: true, reason: "not_required" };
  }
  if (process.env[RUNTIME_STATE_BACKEND_ENV] !== "postgres") {
    return { required: true, ready: false, reason: "primary_backend_not_selected" };
  }
  if (!process.env[PRIMARY_POSTGRES_URL_ENV]?.trim()) {
    return { required: true, ready: false, reason: "primary_postgres_url_missing" };
  }
  return { required: true, ready: true, reason: "primary_backend_configured" };
}

function buildCutoverStatus(requireConfigured, health, drift, primaryBackend) {
  if (!requireConfigured && !primaryBackend.required) {
    return { required: false, ready: drift.status !== "drifted" && drift.status !== "primary_unsupported", reason: "not_required" };
  }
  if (requireConfigured && !health.configured) {
    return { required: true, ready: false, reason: "shadow_not_configured" };
  }
  if (requireConfigured && drift.status === "primary_unsupported") {
    return { required: true, ready: false, reason: "primary_store_not_implemented" };
  }
  if (requireConfigured && drift.status === "drifted") {
    return { required: true, ready: false, reason: "shadow_drifted" };
  }
  if (!primaryBackend.ready) {
    return { required: true, ready: false, reason: primaryBackend.reason };
  }
  return { required: true, ready: true, reason: primaryBackend.required ? "cutover_ready" : "shadow_matched" };
}

// 告警事件默认不写入，只有 operator 显式传入 --record-alert 才会修改 runtime-state。
function recordShadowDriftAlert(stateModule, stateDir, state, alert, drift) {
  if (alert.level === "none") {
    return;
  }
  const at = new Date().toISOString();
  stateModule.saveRuntimeState(stateDir, {
    ...state,
    updatedAt: at,
    sequence: Number(state.sequence ?? 0) + 1,
    events: [
      ...(state.events ?? []),
      {
        taskId: "__system__",
        type: "shadow_drift_detected",
        at,
        summary: `shadow drift ${alert.level}: ${alert.mismatchCount} mismatches`,
        payload: {
          alert,
          drift,
        },
      },
    ].slice(-500),
  });
}

async function readDriftResult(stateModule, shadowModule, stateDir, thresholds) {
  const shadowMode = shadowModule.getRuntimeStateShadowMode();
  const postgresUrl = process.env.DISPATCHER_POSTGRES_URL?.trim();
  const state = shadowMode === "disabled" || !postgresUrl
    ? stateModule.createEmptyRuntimeState()
    : stateModule.loadRuntimeState(stateDir);
  const health = await shadowModule.readRuntimeStateShadowHealth(state);
  const drift = shadowModule.summarizeRuntimeStateShadowDrift(health);
  const alert = shadowModule.evaluateRuntimeStateShadowDriftAlert(drift, thresholds);
  return { state, health, drift, alert };
}

async function checkShadowDrift(options) {
  const { stateModule, shadowModule } = await loadDispatcherModules();
  const thresholds = {
    maxMismatchCount: options.maxMismatchCount,
    maxAbsoluteDelta: options.maxAbsoluteDelta,
  };
  let result = await readDriftResult(stateModule, shadowModule, options.stateDir, thresholds);
  let reconciliation = buildReconciliationStatus(options.reconcile, false, options.reconcile ? "not_needed" : "not_requested");
  if (options.reconcile && !result.health.configured) {
    reconciliation = buildReconciliationStatus(true, false, "shadow_not_configured");
  } else if (options.reconcile && result.drift.status === "drifted") {
    await shadowModule.syncRuntimeStateShadow(result.state);
    result = await readDriftResult(stateModule, shadowModule, options.stateDir, thresholds);
    reconciliation = buildReconciliationStatus(true, true, result.drift.status === "drifted" ? "drift_persists" : "drift_resolved");
  }
  if (options.recordAlert) {
    recordShadowDriftAlert(stateModule, options.stateDir, result.state, result.alert, result.drift);
  }
  const primaryBackend = buildPrimaryBackendStatus(options.requirePrimaryBackend);
  const cutover = buildCutoverStatus(options.requireConfigured, result.health, result.drift, primaryBackend);
  return {
    ok: result.drift.status !== "drifted" && result.drift.status !== "primary_unsupported" && cutover.ready,
    stateDir: options.stateDir,
    drift: result.drift,
    alert: result.alert,
    reconciliation,
    cutover,
    primaryBackend,
    health: result.health,
  };
}

function printResult(result) {
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 2;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  printResult(await checkShadowDrift(options));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

export { parseArgs };
