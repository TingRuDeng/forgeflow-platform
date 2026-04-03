import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_STATE_DIR = ".forgeflow-trae-gateway";
export const SessionStatus = {
    PREPARED: "prepared",
    RUNNING: "running",
    COMPLETED: "completed",
    FAILED: "failed",
    INTERRUPTED: "interrupted",
};
export function createSessionStore(stateDir, options = {}) {
    const now = options.now || (() => new Date().toISOString());
    const randomUUID = options.randomUUID || crypto.randomUUID;
    const resolvedStateDir = stateDir || DEFAULT_STATE_DIR;
    const filePath = path.join(resolvedStateDir, "sessions.json");
    let sessions = new Map();
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
            const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
            sessions = new Map(Object.entries(data.sessions || {}));
            const nowTs = Date.parse(now());
            for (const [id, session] of sessions) {
                if (session.status === SessionStatus.PREPARED ||
                    session.status === SessionStatus.RUNNING) {
                    sessions.set(id, {
                        ...session,
                        status: SessionStatus.INTERRUPTED,
                        error: "Gateway restarted during execution",
                        updatedAt: now(),
                    });
                }
            }
            loaded = true;
            return sessions;
        }
        catch {
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
        const content = JSON.stringify(data, null, 2);
        const tempPath = `${filePath}.tmp`;
        fs.writeFileSync(tempPath, content, "utf8");
        fs.renameSync(tempPath, filePath);
    }
    function ensureLoaded() {
        if (!loaded) {
            load();
        }
    }
    function create(params = {}) {
        ensureLoaded();
        const sessionId = params.sessionId || randomUUID();
        const timestamp = now();
        const session = {
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
    function get(sessionId) {
        ensureLoaded();
        const session = sessions.get(sessionId);
        if (!session) {
            return null;
        }
        return getPublicShape(session);
    }
    function getInternal(sessionId) {
        ensureLoaded();
        return sessions.get(sessionId) || null;
    }
    function update(sessionId, updates) {
        ensureLoaded();
        const session = sessions.get(sessionId);
        if (!session) {
            return null;
        }
        const updated = {
            ...session,
            ...updates,
            updatedAt: now(),
        };
        sessions.set(sessionId, updated);
        save();
        return getPublicShape(updated);
    }
    function markRunning(sessionId) {
        return update(sessionId, {
            status: SessionStatus.RUNNING,
            lastActivityAt: now(),
        });
    }
    function markCompleted(sessionId, result) {
        return update(sessionId, {
            status: SessionStatus.COMPLETED,
            responseText: result.responseText,
            completedAt: now(),
        });
    }
    function markFailed(sessionId, error) {
        return update(sessionId, {
            status: SessionStatus.FAILED,
            error,
            completedAt: now(),
        });
    }
    function touchActivity(sessionId, details = {}) {
        const updates = { lastActivityAt: now() };
        if (details.responseDetected !== undefined) {
            updates.responseDetected = details.responseDetected;
        }
        return update(sessionId, updates);
    }
    function list(filter = {}) {
        ensureLoaded();
        let result = Array.from(sessions.values());
        if (filter.status) {
            result = result.filter((s) => s.status === filter.status);
        }
        return result.map(getPublicShape);
    }
    function prune(ttlMs = SESSION_TTL_MS) {
        ensureLoaded();
        const nowTs = Date.parse(now());
        let pruned = 0;
        for (const [id, session] of sessions) {
            const isTerminal = session.status === SessionStatus.COMPLETED ||
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
    function getPublicShape(session) {
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
        touchActivity,
        list,
        prune,
        getStateFilePath,
    };
}
