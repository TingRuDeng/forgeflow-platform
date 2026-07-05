#!/usr/bin/env node
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");
const checkShadowDriftScriptPath = path.join(repoRoot, "scripts", "check-shadow-drift.mjs");
const verifyApprovalScriptPath = path.join(repoRoot, "scripts", "verify-shadow-cutover-approval.mjs");

function parseArgs(argv) {
  const stateDir = argv[0];
  if (!stateDir) {
    throw new Error("usage: node scripts/verify-shadow-cutover-ready.mjs <stateDir> [--output path]");
  }
  const options = { stateDir, outputPath: undefined };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output") {
      const outputPath = argv[index + 1];
      if (!outputPath) throw new Error("--output requires a path");
      options.outputPath = outputPath;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function parsePayload(stdout) {
  try {
    return JSON.parse(stdout || "{}");
  } catch {
    return { parseError: true, stdout };
  }
}

function runPhase(name, scriptPath, args) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
    timeout: 60_000,
  });
  return {
    name,
    ok: result.status === 0,
    statusCode: result.status ?? 1,
    payload: parsePayload(result.stdout),
    stderr: result.stderr.trim() || undefined,
  };
}

function runCutoverReady(options) {
  const phases = [
    runPhase("strict_cutover_preflight", checkShadowDriftScriptPath, [
      options.stateDir,
      "--require-configured",
      "--require-primary-backend",
      "--max-mismatches",
      "0",
      "--max-delta",
      "0",
    ]),
    runPhase("approval_evidence", verifyApprovalScriptPath, [options.stateDir]),
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
  const result = runCutoverReady(options);
  writeEvidenceFile(options.outputPath, result);
  printResult(result);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

export { parseArgs, runCutoverReady, writeEvidenceFile };
