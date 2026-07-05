#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_APPROVAL_FILE = "shadow-cutover-approval.json";
const DEFAULT_REVOCATION_FILE = "shadow-cutover-revocation.json";
const DEFAULT_REASON = "operator_rollback";

function parseArgs(argv) {
  const stateDir = argv[0];
  if (!stateDir) {
    throw new Error("usage: node scripts/revoke-shadow-cutover.mjs <stateDir> [--approval path] [--output path] [--reason text]");
  }
  const options = {
    stateDir,
    approvalPath: path.join(stateDir, DEFAULT_APPROVAL_FILE),
    outputPath: path.join(stateDir, DEFAULT_REVOCATION_FILE),
    reason: DEFAULT_REASON,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--approval" && next) {
      options.approvalPath = next;
      index += 1;
      continue;
    }
    if (arg === "--output" && next) {
      options.outputPath = next;
      index += 1;
      continue;
    }
    if (arg === "--reason" && next) {
      options.reason = next;
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

function writeJsonTemp(filePath, payload) {
  const resolvedPath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const tempPath = `${resolvedPath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return { resolvedPath, tempPath };
}

function safeTimestamp(value) {
  return value.replace(/[:.]/g, "-");
}

function buildApprovalArchivePath(approvalPath, revokedAt) {
  const resolvedApprovalPath = path.resolve(approvalPath);
  const parsed = path.parse(resolvedApprovalPath);
  return path.join(parsed.dir, `${parsed.name}.revoked-${safeTimestamp(revokedAt)}${parsed.ext}`);
}

function readApproval(approvalPath) {
  let content;
  try {
    content = fs.readFileSync(approvalPath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${DEFAULT_APPROVAL_FILE} is required before revocation (${approvalPath}): ${message}`);
  }
  return {
    content,
    payload: JSON.parse(content),
    sha256: sha256(content),
  };
}

function archiveApproval(approvalPath, revokedAt) {
  const resolvedApprovalPath = path.resolve(approvalPath);
  const archivePath = buildApprovalArchivePath(resolvedApprovalPath, revokedAt);
  fs.renameSync(resolvedApprovalPath, archivePath);
  return archivePath;
}

function revokeCutover(options, now = () => new Date().toISOString()) {
  const approvalPath = path.resolve(options.approvalPath);
  const approval = readApproval(approvalPath);
  const revokedAt = now();
  const outputPath = path.resolve(options.outputPath);
  const approvalArchivedPath = buildApprovalArchivePath(approvalPath, revokedAt);
  const revocation = {
    revoked: true,
    revokedAt,
    reason: options.reason,
    approvalPath,
    approvalSha256: approval.sha256,
    originalEvidenceSha256: approval.payload?.evidenceSha256,
    outputPath,
    approvalArchivedPath,
  };
  const prepared = writeJsonTemp(outputPath, revocation);
  archiveApproval(approvalPath, revokedAt);
  fs.renameSync(prepared.tempPath, prepared.resolvedPath);
  return revocation;
}

function main() {
  const result = revokeCutover(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}

export { parseArgs, revokeCutover };
