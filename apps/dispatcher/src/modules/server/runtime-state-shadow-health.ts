import fs from "node:fs";
import path from "node:path";

import type { RuntimeStateShadowWriteStatus } from "./runtime-state-shadow.js";

export const SHADOW_WRITE_STATUS_FILE = "runtime-state-shadow-status.json";
export const SHADOW_RECONCILER_STATUS_FILE = "shadow-reconciler-status.json";

const SHADOW_WRITE_STATUSES = new Set(["idle", "skipped", "running", "ok", "failed"]);
const SHADOW_RECONCILER_SCHEMA_VERSION = "shadow-reconciler-status/v1";

export type RuntimeStateShadowReconcilerStatus = {
  status: "unknown" | "ok" | "failed";
  schemaVersion: string | null;
  mode: string | null;
  stateDir: string | null;
  intervalMs: number | null;
  maxRuns: number | null;
  runCount: number;
  failedRunCount: number;
  updatedAt: string | null;
  lastRun: Record<string, unknown> | null;
  lastError: string | null;
};

function shadowStatusFilePath(stateDir: string): string {
  return path.join(stateDir, SHADOW_WRITE_STATUS_FILE);
}

function shadowReconcilerStatusFilePath(stateDir: string): string {
  return path.join(stateDir, SHADOW_RECONCILER_STATUS_FILE);
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function coercePersistedStatus(value: unknown): Partial<RuntimeStateShadowWriteStatus> {
  if (!isRecord(value) || !SHADOW_WRITE_STATUSES.has(String(value.status))) {
    throw new Error("invalid shadow health record");
  }
  return {
    status: value.status as RuntimeStateShadowWriteStatus["status"],
    lastAttemptAt: asNullableString(value.lastAttemptAt),
    lastSuccessAt: asNullableString(value.lastSuccessAt),
    lastFailureAt: asNullableString(value.lastFailureAt),
    lastError: asNullableString(value.lastError),
  };
}

function timestampMs(value: string | null | undefined): number {
  const timestamp = Date.parse(value ?? "");
  return Number.isFinite(timestamp) ? timestamp : -1;
}

function statusFileObservedAt(filePath: string): string {
  try {
    return fs.statSync(filePath).mtime.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function coercePersistedReconcilerStatus(value: unknown): RuntimeStateShadowReconcilerStatus {
  if (!isRecord(value) || value.schemaVersion !== SHADOW_RECONCILER_SCHEMA_VERSION) {
    throw new Error("invalid shadow reconciler status record");
  }
  const ok = value.ok === true;
  const failedRunCount = asNullableNumber(value.failedRunCount) ?? 0;
  return {
    status: ok && failedRunCount === 0 ? "ok" : "failed",
    schemaVersion: value.schemaVersion,
    mode: asNullableString(value.mode),
    stateDir: asNullableString(value.stateDir),
    intervalMs: asNullableNumber(value.intervalMs),
    maxRuns: asNullableNumber(value.maxRuns),
    runCount: asNullableNumber(value.runCount) ?? 0,
    failedRunCount,
    updatedAt: asNullableString(value.updatedAt),
    lastRun: isRecord(value.lastRun) ? value.lastRun : null,
    lastError: null,
  };
}

// 选择最新可观测状态，但运行中的进程状态优先，避免旧文件覆盖正在进行的 shadow 写。
export function selectRuntimeStateShadowWriteStatus(
  liveStatus: RuntimeStateShadowWriteStatus,
  persistedStatus: Partial<RuntimeStateShadowWriteStatus> | null,
): RuntimeStateShadowWriteStatus {
  if (!persistedStatus) {
    return liveStatus;
  }
  if (liveStatus.status === "running") {
    return liveStatus;
  }
  if (timestampMs(persistedStatus.lastAttemptAt) > timestampMs(liveStatus.lastAttemptAt)) {
    return {
      ...liveStatus,
      ...persistedStatus,
    };
  }
  return liveStatus;
}

// 读取 durable health record；文件损坏本身也是运维健康失败，必须显式暴露。
export function readPersistedRuntimeStateShadowWriteStatus(
  stateDir: string,
): Partial<RuntimeStateShadowWriteStatus> | null {
  const filePath = shadowStatusFilePath(stateDir);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    return coercePersistedStatus(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const observedAt = statusFileObservedAt(filePath);
    return {
      status: "failed",
      lastAttemptAt: observedAt,
      lastFailureAt: observedAt,
      lastError: `failed to read shadow health record: ${message}`,
    };
  }
}

// 读取自动 reconciliation 最近状态；缺失不视为失败，损坏必须显式暴露给 DR 面板。
export function readPersistedRuntimeStateShadowReconcilerStatus(
  stateDir: string,
): RuntimeStateShadowReconcilerStatus {
  const filePath = shadowReconcilerStatusFilePath(stateDir);
  if (!fs.existsSync(filePath)) {
    return {
      status: "unknown",
      schemaVersion: null,
      mode: null,
      stateDir: null,
      intervalMs: null,
      maxRuns: null,
      runCount: 0,
      failedRunCount: 0,
      updatedAt: null,
      lastRun: null,
      lastError: "shadow reconciler status file not found",
    };
  }
  try {
    return coercePersistedReconcilerStatus(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "failed",
      schemaVersion: null,
      mode: null,
      stateDir: null,
      intervalMs: null,
      maxRuns: null,
      runCount: 0,
      failedRunCount: 1,
      updatedAt: statusFileObservedAt(filePath),
      lastRun: null,
      lastError: `failed to read shadow reconciler status: ${message}`,
    };
  }
}

// 用 rename 原子替换，避免读到半写入的 JSON。
export function persistRuntimeStateShadowWriteStatus(
  stateDir: string,
  status: RuntimeStateShadowWriteStatus,
): void {
  fs.mkdirSync(stateDir, { recursive: true });
  const filePath = shadowStatusFilePath(stateDir);
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(status, null, 2)}\n`);
  fs.renameSync(tempPath, filePath);
}
