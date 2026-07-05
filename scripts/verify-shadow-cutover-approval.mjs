#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_APPROVAL_FILE = "shadow-cutover-approval.json";
const DEFAULT_REVOCATION_FILE = "shadow-cutover-revocation.json";

function parseArgs(argv) {
  const stateDir = argv[0];
  if (!stateDir) {
    throw new Error("usage: node scripts/verify-shadow-cutover-approval.mjs <stateDir> [--approval path] [--revocation path]");
  }
  const options = {
    stateDir,
    approvalPath: path.join(stateDir, DEFAULT_APPROVAL_FILE),
    revocationPath: path.join(stateDir, DEFAULT_REVOCATION_FILE),
  };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--approval" && next) {
      options.approvalPath = next;
      index += 1;
      continue;
    }
    if (arg === "--revocation" && next) {
      options.revocationPath = next;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function readJsonFile(filePath, label) {
  let content;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} is required (${filePath}): ${message}`);
  }
  return {
    content,
    payload: JSON.parse(content),
  };
}

function resolveEvidencePath(approvalPath, evidencePath) {
  if (typeof evidencePath !== "string" || evidencePath.length === 0) {
    throw new Error("approval marker is missing evidencePath");
  }
  return path.isAbsolute(evidencePath)
    ? evidencePath
    : path.resolve(path.dirname(approvalPath), evidencePath);
}

function assertApprovalShape(approval) {
  if (approval?.approved !== true) {
    throw new Error("approval marker is not approved");
  }
  if (approval?.cutoverReason !== "cutover_ready") {
    throw new Error("approval marker cutoverReason must be cutover_ready");
  }
  if (typeof approval?.evidenceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(approval.evidenceSha256)) {
    throw new Error("approval marker is missing a valid evidenceSha256");
  }
}

function verifyCutoverApproval(options) {
  const approvalPath = path.resolve(options.approvalPath);
  const revocationPath = path.resolve(options.revocationPath);
  if (fs.existsSync(revocationPath)) {
    throw new Error(`cutover approval has been revoked: ${revocationPath}`);
  }
  const approvalFile = readJsonFile(approvalPath, DEFAULT_APPROVAL_FILE);
  const approval = approvalFile.payload;
  assertApprovalShape(approval);
  const evidencePath = resolveEvidencePath(approvalPath, approval.evidencePath);
  const evidenceContent = fs.readFileSync(evidencePath, "utf8");
  const actualSha256 = sha256(evidenceContent);
  if (actualSha256 !== approval.evidenceSha256) {
    throw new Error(`evidenceSha256 mismatch: expected ${approval.evidenceSha256}, got ${actualSha256}`);
  }
  return {
    ok: true,
    approvalPath,
    evidencePath,
    evidenceSha256: actualSha256,
    cutoverReason: approval.cutoverReason,
    approvedAt: approval.approvedAt,
  };
}

function main() {
  const result = verifyCutoverApproval(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}

export { parseArgs, verifyCutoverApproval };
