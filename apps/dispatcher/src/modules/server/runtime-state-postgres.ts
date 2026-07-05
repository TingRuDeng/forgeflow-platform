import fs from "node:fs";
import path from "node:path";

import {
  createPgClient,
  loadPrimaryRuntimeStateSnapshot,
  savePrimaryRuntimeStateSnapshot,
} from "@forgeflow/dispatcher-store-postgres";

import { createEmptyRuntimeState } from "./runtime-state-json.js";
import type { RuntimeState } from "./runtime-state.js";

const PRIMARY_POSTGRES_URL_ENV = "DISPATCHER_PRIMARY_POSTGRES_URL";
const PRIMARY_CUTOVER_APPROVAL_FILE_ENV = "DISPATCHER_PRIMARY_CUTOVER_APPROVAL_FILE";
const DEFAULT_PRIMARY_CUTOVER_APPROVAL_FILE = "shadow-cutover-approval.json";
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/i;

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validatePrimaryCutoverApprovalFile(stateDir: string): void {
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
}

export async function loadRuntimeStateFromPostgres(stateDir: string): Promise<RuntimeState> {
  const postgresUrl = getPrimaryPostgresUrl();
  validatePrimaryCutoverApprovalFile(stateDir);
  const client = await createPgClient(postgresUrl);
  try {
    const snapshot = await loadPrimaryRuntimeStateSnapshot<Partial<RuntimeState>>(client);
    return {
      ...createEmptyRuntimeState(),
      ...(snapshot ?? {}),
    };
  } finally {
    await client.end?.();
  }
}

export async function saveRuntimeStateToPostgres(stateDir: string, state: RuntimeState): Promise<void> {
  const postgresUrl = getPrimaryPostgresUrl();
  validatePrimaryCutoverApprovalFile(stateDir);
  const client = await createPgClient(postgresUrl);
  try {
    await savePrimaryRuntimeStateSnapshot(client, state as unknown as Record<string, unknown>);
  } finally {
    await client.end?.();
  }
}
