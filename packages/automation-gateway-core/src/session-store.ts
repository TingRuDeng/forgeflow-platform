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
export * from "./session-store-types.js";

function readSessionFile(filePath: string): Map<string, AutomationSessionRecord> {
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return parseSessionMap(data.sessions);
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

  let sessions = new Map<string, AutomationSessionRecord>();
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

  function load(): Map<string, AutomationSessionRecord> {
    if (!fs.existsSync(filePath)) {
      sessions = new Map();
      loaded = true;
      return sessions;
    }

    try {
      sessions = new Map(
        Array.from(readSessionFile(filePath), ([id, session]) => [id, interruptIfNeeded(session)]),
      );
    } catch {
      sessions = new Map();
    }
    loaded = true;
    return sessions;
  }

  function save(): void {
    fs.mkdirSync(stateDir, { recursive: true });
    const tempPath = `${filePath}.tmp`;
    const data = {
      version: 1,
      updatedAt: now(),
      sessions: Object.fromEntries(sessions),
    };
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tempPath, filePath);
  }

  function ensureLoaded(): void {
    if (!loaded) {
      load();
    }
  }

  function create(params: CreateAutomationSessionParams = {}): AutomationSessionPublic {
    ensureLoaded();
    const timestamp = now();
    const sessionId = params.sessionId || randomUUID();
    const session = createSessionRecord(sessionId, timestamp, params);
    sessions.set(sessionId, session);
    save();
    return publicShape(session);
  }

  function getInternal(sessionId: string): AutomationSessionRecord | null {
    ensureLoaded();
    return sessions.get(sessionId) || null;
  }

  function get(sessionId: string): AutomationSessionPublic | null {
    const session = getInternal(sessionId);
    return session ? publicShape(session) : null;
  }

  function update(
    sessionId: string,
    updates: Partial<AutomationSessionRecord>,
  ): AutomationSessionPublic | null {
    const session = getInternal(sessionId);
    if (!session) {
      return null;
    }
    const updated = { ...session, ...updates, sessionId: session.sessionId, updatedAt: now() };
    sessions.set(sessionId, updated);
    save();
    return publicShape(updated);
  }

  function release(sessionId: string): boolean {
    ensureLoaded();
    const existed = sessions.delete(sessionId);
    if (existed) {
      save();
    }
    return existed;
  }

  function prune(ttlMs = AUTOMATION_SESSION_TTL_MS): number {
    ensureLoaded();
    const nowTs = Date.parse(now());
    let pruned = 0;
    for (const [sessionId, session] of sessions) {
      const updatedAtTs = Date.parse(session.updatedAt);
      if (isTerminalStatus(session.status) && !Number.isNaN(updatedAtTs) && nowTs - updatedAtTs > ttlMs) {
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
      ensureLoaded();
      return Array.from(sessions.values())
        .filter((session) => !filter.status || session.status === filter.status)
        .map(publicShape);
    },
    prune,
    release,
    getStateFilePath: () => filePath,
  };
}
