#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_EVIDENCE_FILE = "shadow-cutover-drill.json";
const DEFAULT_APPROVAL_FILE = "shadow-cutover-approval.json";

function parseArgs(argv) {
  const stateDir = argv[0];
  if (!stateDir) {
    throw new Error("usage: node scripts/approve-shadow-cutover.mjs <stateDir> [--evidence path] [--output path]");
  }
  const options = {
    stateDir,
    evidencePath: path.join(stateDir, DEFAULT_EVIDENCE_FILE),
    outputPath: path.join(stateDir, DEFAULT_APPROVAL_FILE),
  };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--evidence" && next) {
      options.evidencePath = next;
      index += 1;
      continue;
    }
    if (arg === "--output" && next) {
      options.outputPath = next;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function readEvidence(evidencePath) {
  const content = fs.readFileSync(evidencePath, "utf8");
  return {
    content,
    payload: JSON.parse(content),
    sha256: crypto.createHash("sha256").update(content).digest("hex"),
  };
}

function findPhase(payload, name) {
  return Array.isArray(payload?.phases)
    ? payload.phases.find((phase) => phase?.name === name)
    : undefined;
}

function validateEvidence(payload) {
  const cutoverPhase = findPhase(payload, "cutover_preflight");
  const cutoverReason = cutoverPhase?.payload?.cutover?.reason;
  // 只允许从完整通过的 cutover drill 生成审批文件，避免用普通 drift 检查冒充切换证据。
  if (payload?.ok !== true || cutoverPhase?.ok !== true || cutoverReason !== "cutover_ready") {
    throw new Error("cutover drill evidence is not approved: expected ok=true and cutover_preflight=cutover_ready");
  }
}

function writeJsonAtomic(filePath, payload) {
  const resolvedPath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const tempPath = `${resolvedPath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, resolvedPath);
  return resolvedPath;
}

function approveCutover(options, now = () => new Date().toISOString()) {
  const evidencePath = path.resolve(options.evidencePath);
  const evidence = readEvidence(evidencePath);
  validateEvidence(evidence.payload);
  const approval = {
    approved: true,
    approvedAt: now(),
    evidencePath,
    evidenceSha256: evidence.sha256,
    cutoverReason: "cutover_ready",
  };
  const approvalPath = writeJsonAtomic(options.outputPath, approval);
  return { ...approval, approvalPath };
}

function main() {
  const approval = approveCutover(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify(approval, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}

export { approveCutover, parseArgs };
