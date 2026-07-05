#!/usr/bin/env node
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");
const checkShadowDriftScriptPath = path.join(repoRoot, "scripts", "check-shadow-drift.mjs");

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
    throw new Error("usage: node scripts/verify-shadow-cutover-drill.mjs <stateDir> [--output path] [--max-mismatches n] [--max-delta n]");
  }
  const options = { stateDir, maxMismatchCount: 0, maxAbsoluteDelta: 0, outputPath: undefined };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output") {
      const outputPath = argv[index + 1];
      if (!outputPath) throw new Error("--output requires a path");
      options.outputPath = outputPath;
      index += 1;
      continue;
    }
    if (arg === "--max-mismatches" || arg === "--max-delta") {
      const value = parseNonNegativeInteger(argv[index + 1], arg);
      if (arg === "--max-mismatches") options.maxMismatchCount = value;
      if (arg === "--max-delta") options.maxAbsoluteDelta = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function thresholdArgs(options) {
  return [
    "--max-mismatches",
    String(options.maxMismatchCount),
    "--max-delta",
    String(options.maxAbsoluteDelta),
  ];
}

function runShadowCheck(name, stateDir, args) {
  const result = spawnSync(process.execPath, [checkShadowDriftScriptPath, stateDir, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
    timeout: 60_000,
  });
  return {
    name,
    ok: result.status === 0,
    statusCode: result.status ?? 1,
    payload: parsePhasePayload(result.stdout),
    stderr: result.stderr.trim() || undefined,
  };
}

function parsePhasePayload(stdout) {
  try {
    return JSON.parse(stdout || "{}");
  } catch {
    return { parseError: true, stdout };
  }
}

function runCutoverDrill(options) {
  const thresholds = thresholdArgs(options);
  const phases = [
    runShadowCheck("drift_gate", options.stateDir, thresholds),
    runShadowCheck("reconciliation", options.stateDir, ["--reconcile", "--record-alert", ...thresholds]),
    runShadowCheck("cutover_preflight", options.stateDir, [
      "--require-configured",
      "--require-primary-backend",
      "--max-mismatches",
      "0",
      "--max-delta",
      "0",
    ]),
  ];
  return {
    ok: phases.every((phase) => phase.ok),
    stateDir: options.stateDir,
    phases,
  };
}

function printResult(result) {
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 2;
  }
}

function writeEvidenceFile(outputPath, result) {
  if (!outputPath) {
    return;
  }
  const resolvedPath = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const tempPath = `${resolvedPath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, resolvedPath);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = runCutoverDrill(options);
  writeEvidenceFile(options.outputPath, result);
  printResult(result);
}

main();

export { parseArgs, runCutoverDrill };
