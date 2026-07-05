import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const RUNTIME_STATE_BACKEND_ENV = "RUNTIME_STATE_BACKEND";
const PRIMARY_POSTGRES_URL_ENV = "DISPATCHER_PRIMARY_POSTGRES_URL";
const PRIMARY_CUTOVER_APPROVAL_FILE_ENV = "DISPATCHER_PRIMARY_CUTOVER_APPROVAL_FILE";
const PRIMARY_CUTOVER_READY_FILE_ENV = "DISPATCHER_PRIMARY_CUTOVER_READY_FILE";
const DEFAULT_APPROVAL_FILE = "shadow-cutover-approval.json";
const DEFAULT_READY_FILE = "shadow-cutover-ready.json";
const DEFAULT_COMPLETE_FILE = "shadow-cutover-complete.json";
const DEFAULT_REVOCATION_FILE = "shadow-cutover-revocation.json";
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/i;

type CutoverStatus = "unknown" | "ready" | "completed" | "blocked" | "failed";

type CutoverFileStatus = {
  exists: boolean;
  path: string;
};

type CutoverApprovalStatus = CutoverFileStatus & {
  approvedAt: string | null;
  evidencePath: string | null;
  evidenceSha256: string | null;
};

type CutoverReadyStatus = CutoverFileStatus & {
  ok: boolean | null;
  updatedAt: string | null;
};

type CutoverCompleteStatus = CutoverFileStatus & {
  ok: boolean | null;
  completedAt: string | null;
  sequence: number | null;
};

type CutoverRevocationStatus = CutoverFileStatus & {
  revokedAt: string | null;
  reason: string | null;
};

export type RuntimeStatePrimaryCutoverStatus = {
  status: CutoverStatus;
  primaryBackend: {
    selected: boolean;
    configured: boolean;
  };
  approval: CutoverApprovalStatus;
  ready: CutoverReadyStatus;
  complete: CutoverCompleteStatus;
  revocation: CutoverRevocationStatus;
  lastError: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function resolvedFilePath(stateDir: string, envName: string, defaultName: string): string {
  return process.env[envName]?.trim() || path.join(stateDir, defaultName);
}

function readJsonObject(filePath: string): Record<string, unknown> {
  const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!isRecord(payload)) {
    throw new Error(`${path.basename(filePath)} must contain a JSON object`);
  }
  return payload;
}

function fileUpdatedAt(filePath: string): string | null {
  try {
    return fs.statSync(filePath).mtime.toISOString();
  } catch {
    return null;
  }
}

function fileSha256(filePath: string): string {
  const content = fs.readFileSync(filePath, "utf8");
  return crypto.createHash("sha256").update(content).digest("hex");
}

function findPhase(payload: Record<string, unknown>, name: string): Record<string, unknown> | null {
  const phases = Array.isArray(payload.phases) ? payload.phases : [];
  const phase = phases.find((candidate) => isRecord(candidate) && candidate.name === name);
  return isRecord(phase) ? phase : null;
}

function phasePayload(payload: Record<string, unknown>, name: string): Record<string, unknown> {
  const phase = findPhase(payload, name);
  if (!phase || phase.ok !== true) {
    throw new Error(`${name} phase must pass`);
  }
  return isRecord(phase.payload) ? phase.payload : {};
}

function requiredPhase(payload: Record<string, unknown>, name: string): Record<string, unknown> {
  const phase = findPhase(payload, name);
  if (!phase || phase.ok !== true) {
    throw new Error(`${name} phase must pass`);
  }
  return phase;
}

function resolveEvidencePath(approvalPath: string, evidencePath: unknown): string {
  if (typeof evidencePath !== "string" || !evidencePath.trim()) {
    throw new Error("cutover approval must include evidencePath");
  }
  return path.isAbsolute(evidencePath) ? evidencePath : path.resolve(path.dirname(approvalPath), evidencePath);
}

function validateApproval(approvalPath: string): CutoverApprovalStatus {
  const approval = readJsonObject(approvalPath);
  if (approval.approved !== true || approval.cutoverReason !== "cutover_ready") {
    throw new Error("cutover approval must be approved from cutover_ready drill evidence");
  }
  const evidenceSha256 = asNullableString(approval.evidenceSha256);
  if (!evidenceSha256 || !SHA256_HEX_PATTERN.test(evidenceSha256)) {
    throw new Error("cutover approval must include evidenceSha256");
  }
  const evidencePath = resolveEvidencePath(approvalPath, approval.evidencePath);
  // DR 面板展示的是生产切换证据状态，必须复核归档 drill 文件未被后续改写。
  if (fileSha256(evidencePath) !== evidenceSha256) {
    throw new Error("cutover approval evidenceSha256 does not match archived drill evidence");
  }
  return {
    exists: true,
    path: path.resolve(approvalPath),
    approvedAt: asNullableString(approval.approvedAt),
    evidencePath: path.resolve(evidencePath),
    evidenceSha256,
  };
}

function validateReady(readyPath: string, approval: CutoverApprovalStatus): CutoverReadyStatus {
  const ready = readJsonObject(readyPath);
  if (ready.ok !== true) {
    throw new Error("cutover ready evidence must contain ok=true");
  }
  const preflight = phasePayload(ready, "strict_cutover_preflight");
  const cutover = isRecord(preflight.cutover) ? preflight.cutover : {};
  if (cutover.reason !== "cutover_ready") {
    throw new Error("cutover ready preflight must be cutover_ready");
  }
  // ready evidence 必须绑定同一份 approval marker，避免旧审批和新 ready 文件交叉使用。
  const approvalEvidence = phasePayload(ready, "approval_evidence");
  if (path.resolve(String(approvalEvidence.approvalPath ?? "")) !== approval.path) {
    throw new Error("cutover ready approvalPath does not match approval marker");
  }
  if (path.resolve(String(approvalEvidence.evidencePath ?? "")) !== approval.evidencePath) {
    throw new Error("cutover ready evidencePath does not match approval marker");
  }
  if (approvalEvidence.evidenceSha256 !== approval.evidenceSha256) {
    throw new Error("cutover ready evidenceSha256 does not match approval marker");
  }
  return { exists: true, path: path.resolve(readyPath), ok: true, updatedAt: fileUpdatedAt(readyPath) };
}

function validateCompleteReadyEvidence(payload: Record<string, unknown>, approval: CutoverApprovalStatus): void {
  if (payload.ok !== true) {
    throw new Error("cutover completion ready_evidence must contain ok=true");
  }
  const approvalEvidence = phasePayload(payload, "approval_evidence");
  if (path.resolve(String(approvalEvidence.approvalPath ?? "")) !== approval.path) {
    throw new Error("cutover completion approvalPath does not match approval marker");
  }
  if (path.resolve(String(approvalEvidence.evidencePath ?? "")) !== approval.evidencePath) {
    throw new Error("cutover completion evidencePath does not match approval marker");
  }
  if (approvalEvidence.evidenceSha256 !== approval.evidenceSha256) {
    throw new Error("cutover completion evidenceSha256 does not match approval marker");
  }
}

function validateComplete(completePath: string, approval: CutoverApprovalStatus): CutoverCompleteStatus {
  const complete = readJsonObject(completePath);
  if (complete.ok !== true) {
    throw new Error("cutover completion evidence must contain ok=true");
  }
  const readyEvidence = requiredPhase(complete, "ready_evidence");
  validateCompleteReadyEvidence(isRecord(readyEvidence.payload) ? readyEvidence.payload : {}, approval);
  requiredPhase(complete, "primary_backend");
  const snapshot = requiredPhase(complete, "primary_snapshot");
  const payload = isRecord(snapshot.payload) ? snapshot.payload : {};
  if (payload.connected !== true || payload.hasSnapshot !== true) {
    throw new Error("cutover completion primary_snapshot must be connected and contain a snapshot");
  }
  const sequence = typeof payload.sequence === "number" && Number.isFinite(payload.sequence)
    ? payload.sequence
    : null;
  return {
    exists: true,
    path: path.resolve(completePath),
    ok: true,
    completedAt: asNullableString(complete.completedAt),
    sequence,
  };
}

function readRevocation(revocationPath: string): CutoverRevocationStatus {
  if (!fs.existsSync(revocationPath)) {
    return { exists: false, path: path.resolve(revocationPath), revokedAt: null, reason: null };
  }
  try {
    const revocation = readJsonObject(revocationPath);
    return {
      exists: true,
      path: path.resolve(revocationPath),
      revokedAt: asNullableString(revocation.revokedAt),
      reason: asNullableString(revocation.reason),
    };
  } catch {
    return { exists: true, path: path.resolve(revocationPath), revokedAt: null, reason: null };
  }
}

export function readRuntimeStatePrimaryCutoverStatus(stateDir: string): RuntimeStatePrimaryCutoverStatus {
  const approvalPath = resolvedFilePath(stateDir, PRIMARY_CUTOVER_APPROVAL_FILE_ENV, DEFAULT_APPROVAL_FILE);
  const readyPath = resolvedFilePath(stateDir, PRIMARY_CUTOVER_READY_FILE_ENV, DEFAULT_READY_FILE);
  const completePath = path.join(stateDir, DEFAULT_COMPLETE_FILE);
  const revocation = readRevocation(path.join(stateDir, DEFAULT_REVOCATION_FILE));
  const missingApproval = !fs.existsSync(approvalPath);
  const missingReady = !fs.existsSync(readyPath);
  const missingComplete = !fs.existsSync(completePath);
  const base = {
    primaryBackend: {
      selected: process.env[RUNTIME_STATE_BACKEND_ENV] === "postgres",
      configured: Boolean(process.env[PRIMARY_POSTGRES_URL_ENV]?.trim()),
    },
    approval: {
      exists: !missingApproval,
      path: path.resolve(approvalPath),
      approvedAt: null,
      evidencePath: null,
      evidenceSha256: null,
    },
    ready: { exists: !missingReady, path: path.resolve(readyPath), ok: null, updatedAt: null },
    complete: { exists: !missingComplete, path: path.resolve(completePath), ok: null, completedAt: null, sequence: null },
    revocation,
  };
  if (revocation.exists) {
    // revocation marker 的存在本身就是阻断信号，内容损坏也不能被当作可切换。
    return { ...base, status: "blocked", lastError: "shadow cutover revocation marker exists" };
  }
  if (missingApproval || missingReady) {
    return { ...base, status: "unknown", lastError: null };
  }
  try {
    const approval = validateApproval(approvalPath);
    const ready = validateReady(readyPath, approval);
    if (missingComplete) {
      return { ...base, status: "ready", approval, ready, lastError: null };
    }
    const complete = validateComplete(completePath, approval);
    return { ...base, status: "completed", approval, ready, complete, lastError: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ...base, status: "failed", lastError: message };
  }
}
