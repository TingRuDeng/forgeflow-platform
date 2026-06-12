import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { formatLocalTimestamp } from "./time.js";

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
// 默认使用发布包同一用户级目录，避免脚本从不同工作目录启动时写入不同状态文件。
export const DEFAULT_STATE_DIR = path.join(os.homedir(), ".forgeflow-trae-beta", "sessions");

export const SessionStatus = {
  PREPARED: "prepared",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  INTERRUPTED: "interrupted",
} as const;

export type SessionStatusValue = typeof SessionStatus[keyof typeof SessionStatus];

export interface Session {
  sessionId: string;
  status: SessionStatusValue;
  startedAt: string;
  lastActivityAt: string;
  updatedAt: string;
  responseDetected: boolean;
  error: string | null;
  responseText: string | null;
  requestFingerprint: string | null;
  target: Record<string, unknown> | null;
  completedAt: string | null;
}

export interface SessionPublic {
  sessionId: string;
  status: SessionStatusValue;
  startedAt: string;
  lastActivityAt: string;
  responseDetected: boolean;
  error: string | null;
}

export interface CreateSessionParams {
  sessionId?: string;
  requestFingerprint?: string | null;
  target?: Record<string, unknown> | null;
}

export interface TouchActivityDetails {
  responseDetected?: boolean;
}

export interface SessionStore {
  load: () => Map<string, Session>;
  save: () => void;
  create: (params?: CreateSessionParams) => SessionPublic;
  get: (sessionId: string) => SessionPublic | null;
  getInternal: (sessionId: string) => Session | null;
  update: (sessionId: string, updates: Partial<Session>) => SessionPublic | null;
  markRunning: (sessionId: string) => SessionPublic | null;
  markCompleted: (sessionId: string, result: { responseText: string }) => SessionPublic | null;
  markFailed: (sessionId: string, error: string) => SessionPublic | null;
  markReleased: (sessionId: string) => SessionPublic | null;
  touchActivity: (sessionId: string, details?: TouchActivityDetails) => SessionPublic | null;
  list: (filter?: { status?: SessionStatusValue }) => SessionPublic[];
  prune: (ttlMs?: number) => number;
  release: (sessionId: string) => boolean;
  getStateFilePath: () => string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSessionStatus(value: unknown): SessionStatusValue {
  return Object.values(SessionStatus).includes(value as SessionStatusValue)
    ? value as SessionStatusValue
    : SessionStatus.PREPARED;
}

function isTerminalStatus(status: SessionStatusValue): boolean {
  return (
    status === SessionStatus.COMPLETED ||
    status === SessionStatus.FAILED ||
    status === SessionStatus.INTERRUPTED
  );
}

function parseSessionRecord(sessionId: string, value: unknown): Session | null {
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

export function createSessionStore(stateDir: string | null, options: {
  now?: () => string;
  randomUUID?: typeof crypto.randomUUID;
} = {}): SessionStore {
  const now = options.now || (() => formatLocalTimestamp());
  const randomUUID = options.randomUUID || crypto.randomUUID;
  const resolvedStateDir = stateDir || DEFAULT_STATE_DIR;
  const filePath = path.join(resolvedStateDir, "sessions.json");

  let sessions: Map<string, Session> = new Map();
  let loaded = false;

  function getStateFilePath(): string {
    return filePath;
  }

  function load(): Map<string, Session> {
    if (!fs.existsSync(filePath)) {
      sessions = new Map();
      loaded = true;
      return sessions;
    }

    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const rawSessions = isRecord(data.sessions) ? data.sessions : {};
      const nextSessions: Map<string, Session> = new Map();

      for (const [id, rawSession] of Object.entries(rawSessions)) {
        const session = parseSessionRecord(id, rawSession);
        if (!session) {
          continue;
        }
        if (!isTerminalStatus(session.status)) {
          nextSessions.set(id, {
            ...session,
            status: SessionStatus.INTERRUPTED,
            error: "Gateway restarted during execution",
            updatedAt: now(),
          });
          continue;
        }
        nextSessions.set(id, session);
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

  function save(): void {
    fs.mkdirSync(resolvedStateDir, { recursive: true });

    const data = {
      version: 1,
      updatedAt: now(),
      sessions: Object.fromEntries(sessions),
    };

    const content = JSON.stringify(data, null, 2);
    const tempPath = `${filePath}.tmp`;

    fs.writeFileSync(tempPath, content, "utf8");
    fs.renameSync(tempPath, filePath);
  }

  function ensureLoaded(): void {
    if (!loaded) {
      load();
    }
  }

  function create(params: CreateSessionParams = {}): SessionPublic {
    ensureLoaded();

    const sessionId = params.sessionId || randomUUID();
    const timestamp = now();

    const session: Session = {
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

  function get(sessionId: string): SessionPublic | null {
    ensureLoaded();

    const session = sessions.get(sessionId);
    if (!session) {
      return null;
    }

    return getPublicShape(session);
  }

  function getInternal(sessionId: string): Session | null {
    ensureLoaded();
    return sessions.get(sessionId) || null;
  }

  function update(sessionId: string, updates: Partial<Session>): SessionPublic | null {
    ensureLoaded();

    const session = sessions.get(sessionId);
    if (!session) {
      return null;
    }

    const updated: Session = {
      ...session,
      ...updates,
      updatedAt: now(),
    };

    sessions.set(sessionId, updated);
    save();

    return getPublicShape(updated);
  }

  function markRunning(sessionId: string): SessionPublic | null {
    return update(sessionId, {
      status: SessionStatus.RUNNING,
      lastActivityAt: now(),
    });
  }

  function markCompleted(sessionId: string, result: { responseText: string }): SessionPublic | null {
    return update(sessionId, {
      status: SessionStatus.COMPLETED,
      responseText: result.responseText,
      completedAt: now(),
    });
  }

  function markFailed(sessionId: string, error: string): SessionPublic | null {
    return update(sessionId, {
      status: SessionStatus.FAILED,
      error,
      completedAt: now(),
    });
  }

  function markReleased(sessionId: string): SessionPublic | null {
    return update(sessionId, {
      status: SessionStatus.INTERRUPTED,
      error: "Released by user",
      completedAt: now(),
    });
  }

  function release(sessionId: string): boolean {
    ensureLoaded();
    const existed = sessions.delete(sessionId);
    if (existed) {
      save();
    }
    return existed;
  }

  function touchActivity(sessionId: string, details: TouchActivityDetails = {}): SessionPublic | null {
    const updates: Partial<Session> = { lastActivityAt: now() };
    if (details.responseDetected !== undefined) {
      updates.responseDetected = details.responseDetected;
    }
    return update(sessionId, updates);
  }

  function list(filter: { status?: SessionStatusValue } = {}): SessionPublic[] {
    ensureLoaded();

    let result = Array.from(sessions.values());

    if (filter.status) {
      result = result.filter((s) => s.status === filter.status);
    }

    return result.map(getPublicShape);
  }

  function prune(ttlMs: number = SESSION_TTL_MS): number {
    ensureLoaded();

    const nowTs = Date.parse(now());
    let pruned = 0;

    for (const [id, session] of sessions) {
      const isTerminal =
        session.status === SessionStatus.COMPLETED ||
        session.status === SessionStatus.FAILED ||
        session.status === SessionStatus.INTERRUPTED;

      if (isTerminal) {
        const updatedAtTs = Date.parse(session.updatedAt);
        if (nowTs - updatedAtTs > ttlMs) {
          sessions.delete(id);
          pruned++;
        }
      }
    }

    if (pruned > 0) {
      save();
    }

    return pruned;
  }

  function getPublicShape(session: Session): SessionPublic {
    return {
      sessionId: session.sessionId,
      status: session.status,
      startedAt: session.startedAt,
      lastActivityAt: session.lastActivityAt,
      responseDetected: session.responseDetected,
      error: session.error,
    };
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
    markReleased,
    touchActivity,
    list,
    prune,
    release,
    getStateFilePath,
  };
}
