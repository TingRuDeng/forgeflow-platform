#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");
const checkShadowDriftScriptPath = path.join(repoRoot, "scripts", "check-shadow-drift.mjs");
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

function parsePositiveInteger(value, label) {
  const parsed = Number(value);
  if (value === undefined || value === "" || !Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
  return Math.floor(parsed);
}

function parseNonNegativeInteger(value, label) {
  const parsed = Number(value);
  if (value === undefined || value === "" || !Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative number`);
  }
  return Math.floor(parsed);
}

function parseArgs(argv) {
  const stateDir = argv[0];
  if (!stateDir) {
    throw new Error("usage: node scripts/run-shadow-reconciler.mjs <stateDir> [--once] [--interval-ms n] [--max-runs n] [--require-configured] [--require-primary-backend] [--max-mismatches n] [--max-delta n]");
  }
  const options = {
    stateDir,
    once: false,
    intervalMs: DEFAULT_INTERVAL_MS,
    maxRuns: undefined,
    requireConfigured: false,
    requirePrimaryBackend: false,
    maxMismatchCount: undefined,
    maxAbsoluteDelta: undefined,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--once") {
      options.once = true;
      options.maxRuns = 1;
      continue;
    }
    if (arg === "--interval-ms") {
      options.intervalMs = parsePositiveInteger(argv[index + 1], arg);
      index += 1;
      continue;
    }
    if (arg === "--max-runs") {
      options.maxRuns = parsePositiveInteger(argv[index + 1], arg);
      index += 1;
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
    if (arg === "--max-mismatches") {
      options.maxMismatchCount = parseNonNegativeInteger(argv[index + 1], arg);
      index += 1;
      continue;
    }
    if (arg === "--max-delta") {
      options.maxAbsoluteDelta = parseNonNegativeInteger(argv[index + 1], arg);
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function thresholdArgs(options) {
  const args = [];
  if (options.requireConfigured) {
    args.push("--require-configured");
  }
  if (options.requirePrimaryBackend) {
    args.push("--require-primary-backend");
  }
  if (options.maxMismatchCount !== undefined) {
    args.push("--max-mismatches", String(options.maxMismatchCount));
  }
  if (options.maxAbsoluteDelta !== undefined) {
    args.push("--max-delta", String(options.maxAbsoluteDelta));
  }
  return args;
}

function runReconciliationTick(options, runNumber) {
  const result = spawnSync(process.execPath, [
    checkShadowDriftScriptPath,
    options.stateDir,
    "--reconcile",
    "--record-alert",
    ...thresholdArgs(options),
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
    timeout: Math.max(60_000, options.intervalMs),
  });
  return {
    runNumber,
    at: new Date().toISOString(),
    ok: result.status === 0,
    statusCode: result.status ?? 1,
    payload: parsePayload(result.stdout),
    stderr: result.stderr.trim() || undefined,
  };
}

function parsePayload(stdout) {
  try {
    return JSON.parse(stdout || "{}");
  } catch {
    return { parseError: true, stdout };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runReconciler(options) {
  const runs = [];
  const maxRuns = options.maxRuns ?? Number.POSITIVE_INFINITY;
  for (let runNumber = 1; runNumber <= maxRuns; runNumber += 1) {
    const tick = runReconciliationTick(options, runNumber);
    runs.push(tick);
    if (tick.statusCode !== 0 || runNumber >= maxRuns) {
      break;
    }
    await sleep(options.intervalMs);
  }
  return {
    ok: runs.every((run) => run.statusCode === 0),
    mode: options.once ? "once" : "loop",
    stateDir: options.stateDir,
    intervalMs: options.intervalMs,
    runs,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await runReconciler(options);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

export { parseArgs, runReconciler, runReconciliationTick };
