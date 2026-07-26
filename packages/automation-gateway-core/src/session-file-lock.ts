import crypto from "node:crypto";
import fs from "node:fs";

export const DEFAULT_AUTOMATION_SESSION_LOCK_TIMEOUT_MS = 2_000;
export const DEFAULT_AUTOMATION_SESSION_LOCK_RETRY_MS = 25;
export const DEFAULT_AUTOMATION_SESSION_LOCK_STALE_MS = 30_000;

interface SessionFileLockMetadata {
  pid: number;
  ownerToken: string;
  createdAt: string;
}

interface SessionFileLockSnapshot {
  dev: number;
  ino: number;
  mtimeMs: number;
  metadata: SessionFileLockMetadata | null;
}

export interface SessionFileLockOptions {
  timeoutMs: number;
  retryMs: number;
  staleMs: number;
}

export class AutomationSessionLockTimeoutError extends Error {
  constructor(lockPath: string, timeoutMs: number) {
    super(`automation session lock timeout after ${timeoutMs}ms: ${lockPath}`);
    this.name = "AutomationSessionLockTimeoutError";
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readLockSnapshot(lockPath: string): SessionFileLockSnapshot | null {
  try {
    const stats = fs.statSync(lockPath);
    let metadata: SessionFileLockMetadata | null = null;
    try {
      const parsed = JSON.parse(fs.readFileSync(lockPath, "utf8")) as Partial<SessionFileLockMetadata>;
      if (
        Number.isInteger(parsed.pid)
        && Number(parsed.pid) > 0
        && typeof parsed.ownerToken === "string"
        && parsed.ownerToken.length > 0
        && typeof parsed.createdAt === "string"
      ) {
        metadata = {
          pid: Number(parsed.pid),
          ownerToken: parsed.ownerToken,
          createdAt: parsed.createdAt,
        };
      }
    } catch {
      metadata = null;
    }
    return {
      dev: stats.dev,
      ino: stats.ino,
      mtimeMs: stats.mtimeMs,
      metadata,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function unlinkMatchingLock(
  lockPath: string,
  expected: SessionFileLockSnapshot,
  requireOwnerToken: boolean,
): boolean {
  const current = readLockSnapshot(lockPath);
  if (
    !current
    || current.dev !== expected.dev
    || current.ino !== expected.ino
    || (
      requireOwnerToken
      && current.metadata?.ownerToken !== expected.metadata?.ownerToken
    )
  ) {
    return false;
  }
  fs.unlinkSync(lockPath);
  return true;
}

function tryReclaimStaleLock(lockPath: string, staleMs: number): boolean {
  const snapshot = readLockSnapshot(lockPath);
  if (!snapshot) {
    return true;
  }
  const createdAtMs = snapshot.metadata ? Date.parse(snapshot.metadata.createdAt) : Number.NaN;
  const ageMs = Date.now() - (Number.isNaN(createdAtMs) ? snapshot.mtimeMs : createdAtMs);
  if (ageMs < staleMs) {
    return false;
  }
  if (snapshot.metadata && isProcessAlive(snapshot.metadata.pid)) {
    return false;
  }
  return unlinkMatchingLock(lockPath, snapshot, Boolean(snapshot.metadata));
}

function acquireSessionFileLock(
  lockPath: string,
  options: SessionFileLockOptions,
): () => void {
  const startedAt = Date.now();

  while (true) {
    let fd: number | null = null;
    let createdLock: SessionFileLockSnapshot | null = null;
    try {
      fd = fs.openSync(lockPath, "wx");
      const metadata: SessionFileLockMetadata = {
        pid: process.pid,
        ownerToken: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      };
      const stats = fs.fstatSync(fd);
      createdLock = {
        dev: stats.dev,
        ino: stats.ino,
        mtimeMs: stats.mtimeMs,
        metadata,
      };
      fs.writeFileSync(fd, JSON.stringify(metadata), "utf8");
      fs.closeSync(fd);
      fd = null;
      const ownedLock = createdLock;

      let released = false;
      return () => {
        if (released) {
          return;
        }
        released = true;
        if (!unlinkMatchingLock(lockPath, ownedLock, true)) {
          throw new Error(`automation session lock ownership changed before release: ${lockPath}`);
        }
      };
    } catch (error) {
      if (fd !== null) {
        fs.closeSync(fd);
      }
      if (createdLock) {
        try {
          unlinkMatchingLock(lockPath, createdLock, false);
        } catch {
          // Preserve the acquisition or operation error.
        }
      }
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      if (tryReclaimStaleLock(lockPath, options.staleMs)) {
        continue;
      }
      if (Date.now() - startedAt >= options.timeoutMs) {
        throw new AutomationSessionLockTimeoutError(lockPath, options.timeoutMs);
      }
      sleepSync(options.retryMs);
    }
  }
}

export function withSessionFileLock<T>(
  lockPath: string,
  options: SessionFileLockOptions,
  operation: () => T,
): T {
  const releaseLock = acquireSessionFileLock(lockPath, options);
  let result: T;
  try {
    result = operation();
  } catch (error) {
    try {
      releaseLock();
    } catch {
      // Preserve the mutation error.
    }
    throw error;
  }
  releaseLock();
  return result;
}
