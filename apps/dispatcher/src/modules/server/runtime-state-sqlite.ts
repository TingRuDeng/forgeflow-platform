import fs from "node:fs";
import path from "node:path";

import type { RuntimeState } from "./runtime-state.js";

const { DatabaseSync } = await import("node:sqlite");

function nowIso(): string {
  return new Date().toISOString();
}

function dbFilePath(stateDir: string): string {
  return path.join(stateDir, "runtime-state.db");
}

function initDb(db: InstanceType<typeof DatabaseSync>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
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

export function loadRuntimeState(stateDir: string): RuntimeState {
  const filePath = dbFilePath(stateDir);
  if (!fs.existsSync(filePath)) {
    if (fs.existsSync(stateFilePath(stateDir))) {
      const jsonContent = fs.readFileSync(stateFilePath(stateDir), "utf8");
      return importFromJson(stateDir, jsonContent);
    }
    return createEmptyRuntimeState();
  }

  try {
    const db = new DatabaseSync(filePath, { readOnly: true });
    initDb(db);

    const row = db.prepare("SELECT data FROM snapshots WHERE id = 1").get() as
      | { data: string }
      | undefined;

    db.close();

    if (!row) {
      if (fs.existsSync(stateFilePath(stateDir))) {
        const jsonContent = fs.readFileSync(stateFilePath(stateDir), "utf8");
        return importFromJson(stateDir, jsonContent);
      }
      return createEmptyRuntimeState();
    }

    const parsed = JSON.parse(row.data);
    return {
      ...createEmptyRuntimeState(),
      ...parsed,
    };
  } catch {
    if (fs.existsSync(stateFilePath(stateDir))) {
      const jsonContent = fs.readFileSync(stateFilePath(stateDir), "utf8");
      return importFromJson(stateDir, jsonContent);
    }
    return createEmptyRuntimeState();
  }
}

function stateFilePath(stateDir: string): string {
  return path.join(stateDir, "runtime-state.json");
}

export function saveRuntimeState(stateDir: string, state: RuntimeState): void {
  fs.mkdirSync(stateDir, { recursive: true });
  const filePath = dbFilePath(stateDir);

  const db = new DatabaseSync(filePath);
  initDb(db);

  const content = JSON.stringify({
    ...state,
    updatedAt: nowIso(),
  });

  const upsert = db.prepare(`
    INSERT INTO snapshots (id, data, updated_at)
    VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  `);

  upsert.run(content, nowIso());
  db.close();
}

export function importFromJson(stateDir: string, jsonContent: string): RuntimeState {
  const parsed = JSON.parse(jsonContent);
  const state: RuntimeState = {
    ...createEmptyRuntimeState(),
    ...parsed,
  };

  const filePath = dbFilePath(stateDir);
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // ignore
    }
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
