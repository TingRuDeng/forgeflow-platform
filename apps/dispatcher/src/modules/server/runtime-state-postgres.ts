import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import {
  createPgClient,
  listRuntimeAuditEvents,
  loadPrimaryRuntimeStateSnapshotWithRevision,
  savePrimaryRuntimeStateSnapshot,
} from "@forgeflow/dispatcher-store-postgres";

import { createEmptyRuntimeState } from "./runtime-state-json.js";
import type { RuntimeState } from "./runtime-state.js";
import { ensureRuntimeEventIdentities } from "./runtime-events.js";
import {
  attachRuntimeStateStorageRevision,
  readRuntimeStateStorageRevision,
} from "./runtime-state-revision.js";
import type {
  RuntimeAuditEventPage,
  RuntimeAuditEventQueryOptions,
} from "./runtime-events.js";

const PRIMARY_POSTGRES_URL_ENV = "DISPATCHER_PRIMARY_POSTGRES_URL";
const PRIMARY_CUTOVER_APPROVAL_FILE_ENV = "DISPATCHER_PRIMARY_CUTOVER_APPROVAL_FILE";
const PRIMARY_CUTOVER_READY_FILE_ENV = "DISPATCHER_PRIMARY_CUTOVER_READY_FILE";
const DEFAULT_PRIMARY_CUTOVER_APPROVAL_FILE = "shadow-cutover-approval.json";
const DEFAULT_PRIMARY_CUTOVER_READY_FILE = "shadow-cutover-ready.json";
const DEFAULT_PRIMARY_CUTOVER_REVOCATION_FILE = "shadow-cutover-revocation.json";
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/i;

interface PrimaryCutoverApproval {
  approvalPath: string;
  evidencePath: string;
  evidenceSha256: string;
}

function getPrimaryPostgresUrl(): string {
  const value = process.env[PRIMARY_POSTGRES_URL_ENV]?.trim();
  if (!value) {
    throw new Error(`${PRIMARY_POSTGRES_URL_ENV} is required when RUNTIME_STATE_BACKEND=postgres`);
  }
  return value;
}

function getPrimaryCutoverApprovalPath(stateDir: string): string {
  return process.env[PRIMARY_CUTOVER_APPROVAL_FILE_ENV]?.trim()
    || path.join(stateDir, DEFAULT_PRIMARY_CUTOVER_APPROVAL_FILE);
}

function getPrimaryCutoverReadyPath(stateDir: string): string {
  return process.env[PRIMARY_CUTOVER_READY_FILE_ENV]?.trim()
    || path.join(stateDir, DEFAULT_PRIMARY_CUTOVER_READY_FILE);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resolveEvidencePath(approvalPath: string, evidencePath: unknown): string {
  if (typeof evidencePath !== "string" || !evidencePath.trim()) {
    throw new Error(`${PRIMARY_CUTOVER_APPROVAL_FILE_ENV} must include evidencePath`);
  }
  return path.isAbsolute(evidencePath)
    ? evidencePath
    : path.resolve(path.dirname(approvalPath), evidencePath);
}

function validateCutoverEvidenceHash(approvalPath: string, approval: Record<string, unknown>): PrimaryCutoverApproval {
  const evidencePath = resolveEvidencePath(approvalPath, approval.evidencePath);
  const content = fs.readFileSync(evidencePath, "utf8");
  const actualSha256 = crypto.createHash("sha256").update(content).digest("hex");
  if (actualSha256 !== approval.evidenceSha256) {
    throw new Error(`${PRIMARY_CUTOVER_APPROVAL_FILE_ENV} evidenceSha256 does not match archived cutover drill evidence`);
  }
  return {
    approvalPath: path.resolve(approvalPath),
    evidencePath: path.resolve(evidencePath),
    evidenceSha256: actualSha256,
  };
}

function validatePrimaryCutoverApprovalFile(stateDir: string): PrimaryCutoverApproval {
  const revocationPath = path.join(stateDir, DEFAULT_PRIMARY_CUTOVER_REVOCATION_FILE);
  if (fs.existsSync(revocationPath)) {
    throw new Error(`${DEFAULT_PRIMARY_CUTOVER_REVOCATION_FILE} blocks RUNTIME_STATE_BACKEND=postgres until a new cutover approval is generated`);
  }
  const approvalPath = getPrimaryCutoverApprovalPath(stateDir);
  let approval: unknown;
  try {
    approval = JSON.parse(fs.readFileSync(approvalPath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${PRIMARY_CUTOVER_APPROVAL_FILE_ENV} is required before RUNTIME_STATE_BACKEND=postgres (${approvalPath}): ${message}`);
  }
  // 生产 primary backend 必须由可归档 cutover drill 证据显式批准，避免误设环境变量直接切库。
  if (!isPlainObject(approval) || approval.approved !== true) {
    throw new Error(`${PRIMARY_CUTOVER_APPROVAL_FILE_ENV} must contain approved=true before RUNTIME_STATE_BACKEND=postgres`);
  }
  if (approval.cutoverReason !== "cutover_ready") {
    throw new Error(`${PRIMARY_CUTOVER_APPROVAL_FILE_ENV} must be generated from a cutover_ready drill`);
  }
  if (typeof approval.evidenceSha256 !== "string" || !SHA256_HEX_PATTERN.test(approval.evidenceSha256)) {
    throw new Error(`${PRIMARY_CUTOVER_APPROVAL_FILE_ENV} must include evidenceSha256`);
  }
  return validateCutoverEvidenceHash(approvalPath, approval);
}

function readReadyEvidence(readyPath: string): Record<string, unknown> {
  try {
    const ready = JSON.parse(fs.readFileSync(readyPath, "utf8"));
    if (isPlainObject(ready)) {
      return ready;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${PRIMARY_CUTOVER_READY_FILE_ENV} is required before RUNTIME_STATE_BACKEND=postgres (${readyPath}): ${message}`);
  }
  throw new Error(`${PRIMARY_CUTOVER_READY_FILE_ENV} must contain a JSON object before RUNTIME_STATE_BACKEND=postgres`);
}

function findReadyPhase(ready: Record<string, unknown>, name: string): Record<string, unknown> | null {
  const phases = Array.isArray(ready.phases) ? ready.phases : [];
  const phase = phases.find((candidate) => isPlainObject(candidate) && candidate.name === name);
  return isPlainObject(phase) ? phase : null;
}

function readyPhasePayload(readyPath: string, ready: Record<string, unknown>, name: string): Record<string, unknown> {
  const phase = findReadyPhase(ready, name);
  if (!phase || phase.ok !== true) {
    throw new Error(`${PRIMARY_CUTOVER_READY_FILE_ENV} phase ${name} must pass (${readyPath})`);
  }
  return isPlainObject(phase.payload) ? phase.payload : {};
}

function assertMatchingReadyPath(label: string, actual: unknown, expected: string): void {
  if (typeof actual !== "string" || !actual.trim()) {
    throw new Error(`${PRIMARY_CUTOVER_READY_FILE_ENV} ${label} must be recorded`);
  }
  if (path.resolve(actual) !== expected) {
    throw new Error(`${PRIMARY_CUTOVER_READY_FILE_ENV} ${label} does not match approval marker`);
  }
}

function validateReadyApprovalEvidence(payload: Record<string, unknown>, approval: PrimaryCutoverApproval): void {
  assertMatchingReadyPath("approvalPath", payload.approvalPath, approval.approvalPath);
  assertMatchingReadyPath("evidencePath", payload.evidencePath, approval.evidencePath);
  if (payload.evidenceSha256 !== approval.evidenceSha256) {
    throw new Error(`${PRIMARY_CUTOVER_READY_FILE_ENV} ready evidenceSha256 does not match approval marker`);
  }
}

function validatePrimaryCutoverReadyFile(stateDir: string, approval: PrimaryCutoverApproval): void {
  const readyPath = getPrimaryCutoverReadyPath(stateDir);
  const ready = readReadyEvidence(readyPath);
  if (ready.ok !== true) {
    throw new Error(`${PRIMARY_CUTOVER_READY_FILE_ENV} must contain ok=true before RUNTIME_STATE_BACKEND=postgres`);
  }
  const preflightPayload = readyPhasePayload(readyPath, ready, "strict_cutover_preflight");
  const cutover = isPlainObject(preflightPayload.cutover) ? preflightPayload.cutover : {};
  if (cutover.reason !== "cutover_ready") {
    throw new Error(`${PRIMARY_CUTOVER_READY_FILE_ENV} strict_cutover_preflight must be cutover_ready`);
  }
  validateReadyApprovalEvidence(readyPhasePayload(readyPath, ready, "approval_evidence"), approval);
}

function validatePrimaryCutoverFiles(stateDir: string): void {
  const approval = validatePrimaryCutoverApprovalFile(stateDir);
  validatePrimaryCutoverReadyFile(stateDir, approval);
}

export async function loadRuntimeStateFromPostgres(stateDir: string): Promise<RuntimeState> {
  const postgresUrl = getPrimaryPostgresUrl();
  validatePrimaryCutoverFiles(stateDir);
  const client = await createPgClient(postgresUrl);
  try {
    const snapshot = await loadPrimaryRuntimeStateSnapshotWithRevision<Partial<RuntimeState>>(client);
    const state = ensureRuntimeEventIdentities({
      ...createEmptyRuntimeState(),
      ...(snapshot?.state ?? {}),
    });
    return attachRuntimeStateStorageRevision(state, snapshot?.revision ?? null);
  } finally {
    await client.end?.();
  }
}

export async function saveRuntimeStateToPostgres(stateDir: string, state: RuntimeState): Promise<void> {
  const postgresUrl = getPrimaryPostgresUrl();
  validatePrimaryCutoverFiles(stateDir);
  const client = await createPgClient(postgresUrl);
  try {
    const expectedRevision = readRuntimeStateStorageRevision(state);
    if (expectedRevision === undefined) {
      throw new Error(
        "postgres runtime state must be loaded before it can be saved",
      );
    }
    const normalizedState = ensureRuntimeEventIdentities(state);
    const auditEvents = normalizedState.events.map((event) => {
      if (!event.eventId) {
        throw new Error("runtime audit event is missing eventId");
      }
      return {
        eventId: event.eventId,
        taskId: event.taskId,
        attemptId: event.attemptId,
        workerId: event.workerId,
        traceId: event.traceId,
        type: event.type,
        at: event.at,
        summary: event.summary,
        payload: event.payload,
      };
    });
    const revision = await savePrimaryRuntimeStateSnapshot(
      client,
      normalizedState as unknown as Record<string, unknown>,
      expectedRevision,
      auditEvents,
    );
    attachRuntimeStateStorageRevision(normalizedState, revision);
    attachRuntimeStateStorageRevision(state, revision);
  } finally {
    await client.end?.();
  }
}

export async function readRuntimeAuditEventsFromPostgres(
  stateDir: string,
  options: RuntimeAuditEventQueryOptions = {},
): Promise<RuntimeAuditEventPage> {
  const postgresUrl = getPrimaryPostgresUrl();
  validatePrimaryCutoverFiles(stateDir);
  const client = await createPgClient(postgresUrl);
  try {
    const page = await listRuntimeAuditEvents(client, options);
    return {
      ...page,
      scope: "durable_audit",
    };
  } finally {
    await client.end?.();
  }
}
