import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  getAutomationSessionPublicShape,
  isTerminalStatus,
  parseSessionMap,
  parseSessionRecord,
} from "./session-store-records.js";
import {
  AutomationSessionLockTimeoutError,
  DEFAULT_AUTOMATION_SESSION_LOCK_RETRY_MS,
  DEFAULT_AUTOMATION_SESSION_LOCK_STALE_MS,
  DEFAULT_AUTOMATION_SESSION_LOCK_TIMEOUT_MS,
  withSessionFileLock,
} from "./session-file-lock.js";
import {
  AUTOMATION_SESSION_RESTART_ERROR,
  AUTOMATION_SESSION_TTL_MS,
  AutomationSessionStatus,
  type AutomationSessionPublic,
  type AutomationSessionRecord,
  type AutomationSessionStore,
  type AutomationSessionStoreOptions,
  type CreateAutomationSessionParams,
} from "./session-store-types.js";

export {
  getAutomationSessionPublicShape,
  parseSessionRecord,
} from "./session-store-records.js";
export {
  AutomationSessionLockTimeoutError,
  DEFAULT_AUTOMATION_SESSION_LOCK_RETRY_MS,
  DEFAULT_AUTOMATION_SESSION_LOCK_STALE_MS,
  DEFAULT_AUTOMATION_SESSION_LOCK_TIMEOUT_MS,
} from "./session-file-lock.js";
export * from "./session-store-types.js";

function readSessionFile(filePath: string): Map<string, AutomationSessionRecord> {
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return parseSessionMap(data.sessions);
}

function readSessionFileIfPresent(filePath: string): Map<string, AutomationSessionRecord> {
  return fs.existsSync(filePath) ? readSessionFile(filePath) : new Map();
}

function snapshotSession(session: AutomationSessionRecord): string {
  return JSON.stringify(session);
}

function snapshotSessionMap(
  sessions: Map<string, AutomationSessionRecord>,
): Map<string, string> {
  return new Map(Array.from(sessions, ([sessionId, session]) => [
    sessionId,
    snapshotSession(session),
  ]));
}

function resolveLockDuration(
  optionValue: number | undefined,
  environmentValue: string | undefined,
  fallback: number,
): number {
  const candidate = optionValue ?? Number(environmentValue);
  return Number.isFinite(candidate) && candidate > 0 ? candidate : fallback;
}

function createSessionRecord(
  sessionId: string,
  timestamp: string,
  params: CreateAutomationSessionParams,
): AutomationSessionRecord {
  return {
    sessionId,
    status: AutomationSessionStatus.PREPARED,
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
}

export function createPersistentAutomationSessionStore(
  stateDir: string,
  options: AutomationSessionStoreOptions = {},
): AutomationSessionStore {
  const now = options.now || (() => new Date().toISOString());
  const randomUUID = options.randomUUID || (() => crypto.randomUUID());
  const includeResponseText = options.includeResponseText !== false;
  const restartErrorMessage = options.restartErrorMessage || AUTOMATION_SESSION_RESTART_ERROR;
  const filePath = path.join(stateDir, "sessions.json");
  const lockPath = `${filePath}.lock`;
  const lockOptions = {
    timeoutMs: resolveLockDuration(
      options.lockTimeoutMs,
      process.env.FORGEFLOW_TRAE_SESSION_LOCK_TIMEOUT_MS,
      DEFAULT_AUTOMATION_SESSION_LOCK_TIMEOUT_MS,
    ),
    retryMs: resolveLockDuration(
      options.lockRetryMs,
      process.env.FORGEFLOW_TRAE_SESSION_LOCK_RETRY_MS,
      DEFAULT_AUTOMATION_SESSION_LOCK_RETRY_MS,
    ),
    staleMs: resolveLockDuration(
      options.lockStaleMs,
      process.env.FORGEFLOW_TRAE_SESSION_LOCK_STALE_MS,
      DEFAULT_AUTOMATION_SESSION_LOCK_STALE_MS,
    ),
  };

  let sessions = new Map<string, AutomationSessionRecord>();
  let baseline = new Map<string, string>();
  let loaded = false;

  const publicShape = (session: AutomationSessionRecord) => getAutomationSessionPublicShape(
    session,
    { includeResponseText },
  );

  function interruptIfNeeded(session: AutomationSessionRecord): AutomationSessionRecord {
    if (isTerminalStatus(session.status)) {
      return session;
    }
    return {
      ...session,
      status: AutomationSessionStatus.INTERRUPTED,
      error: restartErrorMessage,
      updatedAt: now(),
    };
  }

  function replaceCache(nextSessions: Map<string, AutomationSessionRecord>): void {
    sessions = nextSessions;
    baseline = snapshotSessionMap(nextSessions);
    loaded = true;
  }

  function writeSessionFile(nextSessions: Map<string, AutomationSessionRecord>): void {
    const tempPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    const data = {
      version: 1,
      updatedAt: now(),
      sessions: Object.fromEntries(nextSessions),
    };
    try {
      fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf8");
      fs.renameSync(tempPath, filePath);
    } finally {
      fs.rmSync(tempPath, { force: true });
    }
  }

  function applyLocalChanges(
    latestSessions: Map<string, AutomationSessionRecord>,
  ): Map<string, AutomationSessionRecord> {
    const merged = new Map(latestSessions);
    for (const sessionId of baseline.keys()) {
      if (!sessions.has(sessionId)) {
        merged.delete(sessionId);
      }
    }
    for (const [sessionId, session] of sessions) {
      if (baseline.get(sessionId) !== snapshotSession(session)) {
        merged.set(sessionId, session);
      }
    }
    return merged;
  }

  function hasLocalChanges(): boolean {
    if (sessions.size !== baseline.size) {
      return true;
    }
    return Array.from(sessions).some(
      ([sessionId, session]) => baseline.get(sessionId) !== snapshotSession(session),
    );
  }

  function withLock<T>(operation: () => T): T {
    fs.mkdirSync(stateDir, { recursive: true });
    return withSessionFileLock(lockPath, lockOptions, operation);
  }

  function load(): Map<string, AutomationSessionRecord> {
    return withLock(() => {
      const persisted = readSessionFileIfPresent(filePath);
      let changed = false;
      const nextSessions = new Map(
        Array.from(persisted, ([id, session]) => {
          const interrupted = interruptIfNeeded(session);
          changed ||= interrupted !== session;
          return [id, interrupted];
        }),
      );
      if (changed) {
        writeSessionFile(nextSessions);
      }
      replaceCache(nextSessions);
      return sessions;
    });
  }

  function save(): void {
    ensureLoaded();
    withLock(() => {
      const merged = applyLocalChanges(readSessionFileIfPresent(filePath));
      writeSessionFile(merged);
      replaceCache(merged);
    });
  }

  function ensureLoaded(): void {
    if (!loaded) {
      load();
    }
  }

  function refreshForRead(): void {
    ensureLoaded();
    if (!hasLocalChanges()) {
      replaceCache(readSessionFileIfPresent(filePath));
    }
  }

  function mutate<T>(
    operation: (
      currentSessions: Map<string, AutomationSessionRecord>,
    ) => { changed: boolean; value: T },
  ): T {
    ensureLoaded();
    return withLock(() => {
      const currentSessions = applyLocalChanges(readSessionFileIfPresent(filePath));
      const result = operation(currentSessions);
      if (result.changed || hasLocalChanges()) {
        writeSessionFile(currentSessions);
      }
      replaceCache(currentSessions);
      return result.value;
    });
  }

  function create(params: CreateAutomationSessionParams = {}): AutomationSessionPublic {
    return mutate((currentSessions) => {
      const timestamp = now();
      const sessionId = params.sessionId || randomUUID();
      const session = createSessionRecord(sessionId, timestamp, params);
      currentSessions.set(sessionId, session);
      return { changed: true, value: publicShape(session) };
    });
  }

  function getInternal(sessionId: string): AutomationSessionRecord | null {
    ensureLoaded();
    return sessions.get(sessionId) || null;
  }

  function get(sessionId: string): AutomationSessionPublic | null {
    refreshForRead();
    const session = sessions.get(sessionId) || null;
    return session ? publicShape(session) : null;
  }

  function update(
    sessionId: string,
    updates: Partial<AutomationSessionRecord>,
  ): AutomationSessionPublic | null {
    return mutate((currentSessions) => {
      const session = currentSessions.get(sessionId);
      if (!session) {
        return { changed: false, value: null };
      }
      const updated = { ...session, ...updates, sessionId: session.sessionId, updatedAt: now() };
      currentSessions.set(sessionId, updated);
      return { changed: true, value: publicShape(updated) };
    });
  }

  function release(sessionId: string): boolean {
    return mutate((currentSessions) => {
      const existed = currentSessions.delete(sessionId);
      return { changed: existed, value: existed };
    });
  }

  function prune(ttlMs = AUTOMATION_SESSION_TTL_MS): number {
    return mutate((currentSessions) => {
      const nowTs = Date.parse(now());
      let pruned = 0;
      for (const [sessionId, session] of currentSessions) {
        const updatedAtTs = Date.parse(session.updatedAt);
        if (
          isTerminalStatus(session.status)
          && !Number.isNaN(updatedAtTs)
          && nowTs - updatedAtTs > ttlMs
        ) {
          currentSessions.delete(sessionId);
          pruned += 1;
        }
      }
      return { changed: pruned > 0, value: pruned };
    });
  }

  return {
    load,
    save,
    create,
    get,
    getInternal,
    update,
    markRunning: (sessionId) => update(sessionId, {
      status: AutomationSessionStatus.RUNNING,
      lastActivityAt: now(),
    }),
    markCompleted: (sessionId, result) => update(sessionId, {
      status: AutomationSessionStatus.COMPLETED,
      responseText: result.responseText,
      completedAt: now(),
    }),
    markFailed: (sessionId, error) => update(sessionId, {
      status: AutomationSessionStatus.FAILED,
      error,
      completedAt: now(),
    }),
    markReleased: (sessionId) => update(sessionId, {
      status: AutomationSessionStatus.INTERRUPTED,
      error: "Released by user",
      completedAt: now(),
    }),
    touchActivity: (sessionId, details = {}) => update(sessionId, {
      lastActivityAt: now(),
      ...(details.responseDetected === undefined ? {} : { responseDetected: details.responseDetected }),
    }),
    list: (filter = {}) => {
      refreshForRead();
      return Array.from(sessions.values())
        .filter((session) => !filter.status || session.status === filter.status)
        .map(publicShape);
    },
    prune,
    release,
    getStateFilePath: () => filePath,
  };
}
