import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { RuntimeState } from "./runtime-state.js";
import { formatLocalTimestamp } from "../time.js";

const { DatabaseSync } = await import("node:sqlite");

const STATE_FALLBACK_ENV = "FORGEFLOW_ALLOW_STATE_FALLBACK_JSON";
const SQLITE_BUSY_TIMEOUT_MS = 5_000;

function nowIso(): string {
  return formatLocalTimestamp();
}

function dbFilePath(stateDir: string): string {
  return path.join(stateDir, "runtime-state.db");
}

function stateFilePath(stateDir: string): string {
  return path.join(stateDir, "runtime-state.json");
}

function readOnlyDbUri(filePath: string): string {
  const url = pathToFileURL(filePath);
  url.searchParams.set("mode", "ro");
  url.searchParams.set("immutable", "1");
  return url.href;
}

function checksumSha256(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function applyPragmas(db: InstanceType<typeof DatabaseSync>): void {
  db.exec(`PRAGMA journal_mode = WAL;`);
  db.exec(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS};`);
}

function applyReadOnlyPragmas(db: InstanceType<typeof DatabaseSync>): void {
  db.exec(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS};`);
}

function initDb(db: InstanceType<typeof DatabaseSync>): void {
  applyPragmas(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      revision INTEGER PRIMARY KEY AUTOINCREMENT,
      data TEXT NOT NULL,
      checksum_sha256 TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

function createEmptyRuntimeState(): RuntimeState {
  return {
    version: 1,
    updatedAt: nowIso(),
    sequence: 0,
    workers: [],
    tasks: [],
    events: [],
    assignments: [],
    reviews: [],
    pullRequests: [],
    dispatches: [],
  };
}

function coerceRuntimeState(parsed: unknown): RuntimeState {
  return {
    ...createEmptyRuntimeState(),
    ...(parsed as Partial<RuntimeState>),
  };
}

function shouldAllowJsonFallback(): boolean {
  return process.env[STATE_FALLBACK_ENV] === "1";
}

function loadFromJsonFallback(stateDir: string, reason: unknown): RuntimeState {
  const jsonPath = stateFilePath(stateDir);
  if (!shouldAllowJsonFallback() || !fs.existsSync(jsonPath)) {
    const message = reason instanceof Error ? reason.message : String(reason);
    throw new Error(`failed to load runtime-state.db: ${message}`);
  }

  const jsonContent = fs.readFileSync(jsonPath, "utf8");
  return importFromJson(stateDir, jsonContent);
}

export function loadRuntimeState(stateDir: string): RuntimeState {
  const filePath = dbFilePath(stateDir);
  if (!fs.existsSync(filePath)) {
    if (fs.existsSync(stateFilePath(stateDir))) {
      const jsonContent = fs.readFileSync(stateFilePath(stateDir), "utf8");
      return importFromJson(stateDir, jsonContent);
    }
    return createEmptyRuntimeState();
  }

  let db: InstanceType<typeof DatabaseSync> | null = null;
  try {
    db = new DatabaseSync(readOnlyDbUri(filePath), { readOnly: true });
    applyReadOnlyPragmas(db);
    const row = db
      .prepare(
        "SELECT revision, data, checksum_sha256, created_at FROM snapshots ORDER BY revision DESC LIMIT 1",
      )
      .get() as
      | {
          revision: number;
          data: string;
          checksum_sha256: string;
          created_at: string;
        }
      | undefined;

    if (!row) {
      throw new Error("snapshots table is empty");
    }

    const actualChecksum = checksumSha256(row.data);
    if (actualChecksum !== row.checksum_sha256) {
      throw new Error(`snapshot checksum mismatch at revision ${row.revision}`);
    }

    return coerceRuntimeState(JSON.parse(row.data));
  } catch (error) {
    return loadFromJsonFallback(stateDir, error);
  } finally {
    db?.close();
  }
}

export function saveRuntimeState(stateDir: string, state: RuntimeState): void {
  fs.mkdirSync(stateDir, { recursive: true });
  const filePath = dbFilePath(stateDir);
  const db = new DatabaseSync(filePath);

  try {
    initDb(db);

    const content = JSON.stringify({
      ...state,
      updatedAt: nowIso(),
    });
    const createdAt = nowIso();
    const checksum = checksumSha256(content);

    db.prepare(`
      INSERT INTO snapshots (data, checksum_sha256, created_at)
      VALUES (?, ?, ?)
    `).run(content, checksum, createdAt);
  } finally {
    db.close();
  }
}

export function importFromJson(stateDir: string, jsonContent: string): RuntimeState {
  const state = coerceRuntimeState(JSON.parse(jsonContent));
  const filePath = dbFilePath(stateDir);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  saveRuntimeState(stateDir, state);
  return loadRuntimeState(stateDir);
}

export const sqliteStore = {
  load: loadRuntimeState,
  save: saveRuntimeState,
  createEmpty: createEmptyRuntimeState,
  importFromJson,
};
