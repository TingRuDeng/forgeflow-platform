#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");
const checkShadowDriftScriptPath = path.join(repoRoot, "scripts", "check-shadow-drift.mjs");
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const STATUS_FILE_ENV = "DISPATCHER_SHADOW_RECONCILER_STATUS_FILE";

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

function usage() {
  return "usage: node scripts/run-shadow-reconciler.mjs <stateDir> [--once] [--interval-ms n] [--max-runs n] [--output path] [--require-configured] [--require-primary-backend] [--max-mismatches n] [--max-delta n]";
}

function createDefaultOptions(stateDir) {
  return {
    stateDir,
    once: false,
    intervalMs: DEFAULT_INTERVAL_MS,
    maxRuns: undefined,
    requireConfigured: false,
    requirePrimaryBackend: false,
    maxMismatchCount: undefined,
    maxAbsoluteDelta: undefined,
    outputPath: process.env[STATUS_FILE_ENV] || undefined,
  };
}

function readRequiredValue(argv, index, label) {
  const value = argv[index + 1];
  if (!value) {
    throw new Error(`${label} requires a value`);
  }
  return { value, nextIndex: index + 1 };
}

function applyArg(options, argv, index) {
  const arg = argv[index];
  if (arg === "--once") {
    options.once = true;
    options.maxRuns = 1;
    return index;
  }
  if (arg === "--interval-ms") {
    const parsed = readRequiredValue(argv, index, arg);
    options.intervalMs = parsePositiveInteger(parsed.value, arg);
    return parsed.nextIndex;
  }
  if (arg === "--max-runs") {
    const parsed = readRequiredValue(argv, index, arg);
    options.maxRuns = parsePositiveInteger(parsed.value, arg);
    return parsed.nextIndex;
  }
  if (arg === "--output") {
    const parsed = readRequiredValue(argv, index, arg);
    options.outputPath = parsed.value;
    return parsed.nextIndex;
  }
  if (arg === "--require-configured") {
    options.requireConfigured = true;
    return index;
  }
  if (arg === "--require-primary-backend") {
    options.requirePrimaryBackend = true;
    return index;
  }
  if (arg === "--max-mismatches") {
    const parsed = readRequiredValue(argv, index, arg);
    options.maxMismatchCount = parseNonNegativeInteger(parsed.value, arg);
    return parsed.nextIndex;
  }
  if (arg === "--max-delta") {
    const parsed = readRequiredValue(argv, index, arg);
    options.maxAbsoluteDelta = parseNonNegativeInteger(parsed.value, arg);
    return parsed.nextIndex;
  }
  throw new Error(`unknown argument: ${arg}`);
}

function parseArgs(argv) {
  const stateDir = argv[0];
  if (!stateDir) {
    throw new Error(usage());
  }
  const options = createDefaultOptions(stateDir);
  for (let index = 1; index < argv.length; index += 1) {
    index = applyArg(options, argv, index);
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

function writeJsonAtomically(filePath, payload) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);
  fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`);
  fs.renameSync(tempPath, filePath);
}

function buildStatusSnapshot(options, runs) {
  const lastRun = runs[runs.length - 1];
  const failedRuns = runs.filter((run) => run.statusCode !== 0).length;
  return {
    schemaVersion: "shadow-reconciler-status/v1",
    ok: failedRuns === 0,
    mode: options.once ? "once" : "loop",
    stateDir: options.stateDir,
    intervalMs: options.intervalMs,
    maxRuns: Number.isFinite(options.maxRuns) ? options.maxRuns : null,
    runCount: runs.length,
    failedRunCount: failedRuns,
    updatedAt: lastRun?.at ?? new Date().toISOString(),
    lastRun,
  };
}

function writeStatusSnapshot(options, runs) {
  if (!options.outputPath) {
    return;
  }
  writeJsonAtomically(options.outputPath, buildStatusSnapshot(options, runs));
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
    writeStatusSnapshot(options, runs);
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

export { buildStatusSnapshot, parseArgs, runReconciler, runReconciliationTick };
