import fs from "node:fs";
import path from "node:path";

import type { RuntimeStateShadowWriteStatus } from "./runtime-state-shadow.js";

export const SHADOW_WRITE_STATUS_FILE = "runtime-state-shadow-status.json";

const SHADOW_WRITE_STATUSES = new Set(["idle", "skipped", "running", "ok", "failed"]);

function shadowStatusFilePath(stateDir: string): string {
  return path.join(stateDir, SHADOW_WRITE_STATUS_FILE);
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
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
