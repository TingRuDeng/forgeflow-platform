export const SQLITE_SCHEMA_STATEMENTS = {
  workers: `
    CREATE TABLE IF NOT EXISTS workers (
      id TEXT PRIMARY KEY,
      pool TEXT NOT NULL,
      status TEXT NOT NULL,
      last_heartbeat_at TEXT NOT NULL,
      current_task_id TEXT
    );
  `,
  tasks: `
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      repo TEXT NOT NULL,
      title TEXT NOT NULL,
      pool TEXT NOT NULL,
      status TEXT NOT NULL
    );
  `,
  task_events: `
    CREATE TABLE IF NOT EXISTS task_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      type TEXT NOT NULL,
      at TEXT NOT NULL,
      payload TEXT NOT NULL
    );
  `,
} as const;
