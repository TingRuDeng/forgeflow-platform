import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_STATE_DIR = path.join(os.homedir(), ".forgeflow-trae-beta", "sessions");
const RESTART_ERROR_MESSAGE = "Gateway restarted during execution";

export enum SessionStatus {
  PREPARED = "prepared",
  RUNNING = "running",
  COMPLETED = "completed",
  FAILED = "failed",
  INTERRUPTED = "interrupted",
}

export interface SessionPublicShape {
  sessionId: string;
  status: SessionStatus;
  startedAt: string;
  lastActivityAt: string;
  responseDetected: boolean;
  error: string | null;
  responseText: string | null;
}

export interface SessionRecord extends SessionPublicShape {
  updatedAt: string;
  responseText: string | null;
  requestFingerprint: string | null;
  target: Record<string, unknown> | null;
  completedAt: string | null;
}

export interface CreateSessionStoreOptions {
  now?: () => string;
  randomUUID?: () => string;
}

export interface CreateSessionParams {
  sessionId?: string;
  requestFingerprint?: string | null;
  target?: Record<string, unknown> | null;
}

export interface MarkCompletedResult {
  responseText: string;
}

export interface TouchActivityDetails {
  responseDetected?: boolean;
}

export interface SessionListFilter {
  status?: SessionStatus;
}

export interface SessionStore {
  load: () => Map<string, SessionRecord>;
  save: () => void;
  create: (params?: CreateSessionParams) => SessionPublicShape;
  get: (sessionId: string) => SessionPublicShape | null;
  getInternal: (sessionId: string) => SessionRecord | null;
  update: (sessionId: string, updates: Partial<SessionRecord>) => SessionPublicShape | null;
  markRunning: (sessionId: string) => SessionPublicShape | null;
  markCompleted: (sessionId: string, result: MarkCompletedResult) => SessionPublicShape | null;
  markFailed: (sessionId: string, error: string) => SessionPublicShape | null;
  release: (sessionId: string) => boolean;
  touchActivity: (sessionId: string, details?: TouchActivityDetails) => SessionPublicShape | null;
  list: (filter?: SessionListFilter) => SessionPublicShape[];
  prune: (ttlMs?: number) => number;
  getStateFilePath: () => string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSessionStatus(value: unknown): SessionStatus {
  switch (value) {
    case SessionStatus.PREPARED:
    case SessionStatus.RUNNING:
    case SessionStatus.COMPLETED:
    case SessionStatus.FAILED:
    case SessionStatus.INTERRUPTED:
      return value;
    default:
      return SessionStatus.PREPARED;
  }
}

function isTerminalStatus(status: SessionStatus): boolean {
  return (
    status === SessionStatus.COMPLETED
    || status === SessionStatus.FAILED
    || status === SessionStatus.INTERRUPTED
  );
}

function parseSessionRecord(sessionId: string, value: unknown): SessionRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const rawTarget = value.target;

  return {
    sessionId: typeof value.sessionId === "string" && value.sessionId.trim() ? value.sessionId : sessionId,
    status: parseSessionStatus(value.status),
    startedAt: typeof value.startedAt === "string" ? value.startedAt : "",
    lastActivityAt: typeof value.lastActivityAt === "string" ? value.lastActivityAt : "",
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
    responseDetected: value.responseDetected === true,
    error: typeof value.error === "string" ? value.error : null,
    responseText: typeof value.responseText === "string" ? value.responseText : null,
    requestFingerprint: typeof value.requestFingerprint === "string" ? value.requestFingerprint : null,
    target: isRecord(rawTarget) ? rawTarget : null,
    completedAt: typeof value.completedAt === "string" ? value.completedAt : null,
  };
}

export function getPublicShape(session: SessionRecord): SessionPublicShape {
  return {
    sessionId: session.sessionId,
    status: session.status,
    startedAt: session.startedAt,
    lastActivityAt: session.lastActivityAt,
    responseDetected: session.responseDetected,
    error: session.error,
    responseText: session.responseText,
  };
}

export function createSessionStore(
  stateDir?: string | null,
  options: CreateSessionStoreOptions = {},
): SessionStore {
  const now = options.now || (() => new Date().toISOString());
  const randomUUID = options.randomUUID || (() => crypto.randomUUID());
  const resolvedStateDir = stateDir || DEFAULT_STATE_DIR;
  const filePath = path.join(resolvedStateDir, "sessions.json");

  let sessions = new Map<string, SessionRecord>();
  let loaded = false;

  function getStateFilePath() {
    return filePath;
  }

  function load() {
    if (!fs.existsSync(filePath)) {
      sessions = new Map();
      loaded = true;
      return sessions;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as { sessions?: unknown };
      const nextSessions = new Map<string, SessionRecord>();
      const rawSessions = isRecord(parsed.sessions) ? parsed.sessions : {};

      for (const [sessionId, rawSession] of Object.entries(rawSessions)) {
        const session = parseSessionRecord(sessionId, rawSession);
        if (!session) {
          continue;
        }
        if (!isTerminalStatus(session.status)) {
          nextSessions.set(sessionId, {
            ...session,
            status: SessionStatus.INTERRUPTED,
            error: RESTART_ERROR_MESSAGE,
            updatedAt: now(),
          });
          continue;
        }
        nextSessions.set(sessionId, session);
      }

      sessions = nextSessions;
      loaded = true;
      return sessions;
    } catch {
      sessions = new Map();
      loaded = true;
      return sessions;
    }
  }

  function save() {
    fs.mkdirSync(resolvedStateDir, { recursive: true });

    const data = {
      version: 1,
      updatedAt: now(),
      sessions: Object.fromEntries(sessions),
    };
    const tempPath = `${filePath}.tmp`;

    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tempPath, filePath);
  }

  function ensureLoaded() {
    if (!loaded) {
      load();
    }
  }

  function create(params: CreateSessionParams = {}) {
    ensureLoaded();

    const timestamp = now();
    const sessionId = params.sessionId || randomUUID();
    const session: SessionRecord = {
      sessionId,
      status: SessionStatus.PREPARED,
      startedAt: timestamp,
      lastActivityAt: timestamp,
      updatedAt: timestamp,
      responseDetected: false,
      error: null,
      responseText: null,
      requestFingerprint: params.requestFingerprint || null,
      target: params.target || null,
      completedAt: null,
    };

    sessions.set(sessionId, session);
    save();
    return getPublicShape(session);
  }

  function get(sessionId: string) {
    ensureLoaded();
    const session = sessions.get(sessionId);
    return session ? getPublicShape(session) : null;
  }

  function getInternal(sessionId: string) {
    ensureLoaded();
    return sessions.get(sessionId) || null;
  }

  function update(sessionId: string, updates: Partial<SessionRecord>) {
    ensureLoaded();

    const session = sessions.get(sessionId);
    if (!session) {
      return null;
    }

    const updated: SessionRecord = {
      ...session,
      ...updates,
      sessionId: session.sessionId,
      updatedAt: now(),
    };
    sessions.set(sessionId, updated);
    save();
    return getPublicShape(updated);
  }

  function markRunning(sessionId: string) {
    return update(sessionId, {
      status: SessionStatus.RUNNING,
      lastActivityAt: now(),
    });
  }

  function markCompleted(sessionId: string, result: MarkCompletedResult) {
    return update(sessionId, {
      status: SessionStatus.COMPLETED,
      responseText: result.responseText,
      completedAt: now(),
    });
  }

  function markFailed(sessionId: string, error: string) {
    return update(sessionId, {
      status: SessionStatus.FAILED,
      error,
      completedAt: now(),
    });
  }

  function release(sessionId: string) {
    ensureLoaded();

    const existed = sessions.delete(sessionId);
    if (existed) {
      save();
    }
    return existed;
  }

  function touchActivity(sessionId: string, details: TouchActivityDetails = {}) {
    return update(sessionId, {
      lastActivityAt: now(),
      ...(details.responseDetected === undefined ? {} : { responseDetected: details.responseDetected }),
    });
  }

  function list(filter: SessionListFilter = {}) {
    ensureLoaded();

    const items = Array.from(sessions.values());
    const filtered = filter.status
      ? items.filter((session) => session.status === filter.status)
      : items;
    return filtered.map(getPublicShape);
  }

  function prune(ttlMs = SESSION_TTL_MS) {
    ensureLoaded();

    const nowTs = Date.parse(now());
    let pruned = 0;

    for (const [sessionId, session] of sessions) {
      if (!isTerminalStatus(session.status)) {
        continue;
      }
      const updatedAtTs = Date.parse(session.updatedAt);
      if (Number.isNaN(updatedAtTs)) {
        continue;
      }
      if (nowTs - updatedAtTs > ttlMs) {
        sessions.delete(sessionId);
        pruned += 1;
      }
    }

    if (pruned > 0) {
      save();
    }

    return pruned;
  }

  return {
    load,
    save,
    create,
    get,
    getInternal,
    update,
    markRunning,
    markCompleted,
    markFailed,
    release,
    touchActivity,
    list,
    prune,
    getStateFilePath,
  };
}
