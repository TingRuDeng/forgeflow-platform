import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AutomationSessionLockTimeoutError,
  AutomationSessionStatus,
  createPersistentAutomationSessionStore,
  getAutomationSessionPublicShape,
} from "../src/index.js";
import { withSessionFileLock } from "../src/session-file-lock.js";

describe("session-store", () => {
  let tempDir = "";

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-core-session-store-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = "";
  });

  it("saves sessions atomically and interrupts non-terminal sessions after restart", () => {
    const store = createPersistentAutomationSessionStore(tempDir, {
      now: () => "2026-03-30T10:00:00.000Z",
      randomUUID: () => "generated-session",
    });

    const created = store.create();
    const filePath = store.getStateFilePath();

    expect(created).toEqual({
      sessionId: "generated-session",
      status: AutomationSessionStatus.PREPARED,
      startedAt: "2026-03-30T10:00:00.000Z",
      lastActivityAt: "2026-03-30T10:00:00.000Z",
      responseDetected: false,
      error: null,
      responseText: null,
    });
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.existsSync(`${filePath}.tmp`)).toBe(false);

    const reloadedStore = createPersistentAutomationSessionStore(tempDir, {
      now: () => "2026-03-30T10:05:00.000Z",
    });

    expect(reloadedStore.get("generated-session")).toMatchObject({
      sessionId: "generated-session",
      status: AutomationSessionStatus.INTERRUPTED,
      error: "Gateway restarted during execution",
    });
  });

  it("prunes expired terminal sessions without pruning running sessions", () => {
    let nowValue = "2026-03-30T12:00:00.000Z";
    const store = createPersistentAutomationSessionStore(tempDir, {
      now: () => nowValue,
    });

    store.create({ sessionId: "expired-completed" });
    store.markCompleted("expired-completed", { responseText: "done" });
    store.create({ sessionId: "expired-running" });
    store.markRunning("expired-running");

    const expiredCompleted = store.getInternal("expired-completed");
    const expiredRunning = store.getInternal("expired-running");
    if (!expiredCompleted || !expiredRunning) {
      throw new Error("expected seeded sessions to exist");
    }

    expiredCompleted.updatedAt = "2026-03-29T10:59:59.999Z";
    expiredRunning.updatedAt = "2026-03-29T10:59:59.999Z";
    store.save();

    nowValue = "2026-03-30T12:00:00.000Z";

    expect(store.prune()).toBe(1);
    expect(store.get("expired-completed")).toBeNull();
    expect(store.get("expired-running")).toMatchObject({
      sessionId: "expired-running",
      status: AutomationSessionStatus.RUNNING,
    });
  });

  it("can expose or hide response text in public session shapes", () => {
    const internalSession = {
      sessionId: "internal-session",
      status: AutomationSessionStatus.COMPLETED,
      startedAt: "2026-03-30T10:00:00.000Z",
      lastActivityAt: "2026-03-30T10:05:00.000Z",
      updatedAt: "2026-03-30T10:05:00.000Z",
      responseDetected: true,
      error: null,
      responseText: "final response",
      requestFingerprint: "fingerprint",
      target: { id: "target-1" },
      completedAt: "2026-03-30T10:05:00.000Z",
    };

    expect(getAutomationSessionPublicShape(internalSession)).toEqual({
      sessionId: "internal-session",
      status: AutomationSessionStatus.COMPLETED,
      startedAt: "2026-03-30T10:00:00.000Z",
      lastActivityAt: "2026-03-30T10:05:00.000Z",
      responseDetected: true,
      error: null,
      responseText: "final response",
    });
    expect(getAutomationSessionPublicShape(internalSession, { includeResponseText: false })).toEqual({
      sessionId: "internal-session",
      status: AutomationSessionStatus.COMPLETED,
      startedAt: "2026-03-30T10:00:00.000Z",
      lastActivityAt: "2026-03-30T10:05:00.000Z",
      responseDetected: true,
      error: null,
    });
  });

  it("merges mutations from independently loaded store instances", () => {
    const firstStore = createPersistentAutomationSessionStore(tempDir);
    const secondStore = createPersistentAutomationSessionStore(tempDir);

    firstStore.load();
    secondStore.load();
    firstStore.create({ sessionId: "first-session" });
    secondStore.create({ sessionId: "second-session" });
    firstStore.markRunning("first-session");
    secondStore.markCompleted("second-session", { responseText: "done" });

    const reloaded = createPersistentAutomationSessionStore(tempDir);
    expect(reloaded.list().map((session) => session.sessionId).sort()).toEqual([
      "first-session",
      "second-session",
    ]);
    expect(reloaded.get("first-session")).toMatchObject({
      status: AutomationSessionStatus.INTERRUPTED,
    });
    expect(reloaded.get("second-session")).toMatchObject({
      status: AutomationSessionStatus.COMPLETED,
    });
  });

  it("does not reclaim a stale-looking lock owned by a live process", () => {
    fs.writeFileSync(path.join(tempDir, "sessions.json.lock"), JSON.stringify({
      pid: process.pid,
      ownerToken: "live-owner",
      createdAt: "2020-01-01T00:00:00.000Z",
    }));
    const store = createPersistentAutomationSessionStore(tempDir, {
      lockTimeoutMs: 20,
      lockRetryMs: 1,
      lockStaleMs: 1,
    });

    expect(() => store.create({ sessionId: "blocked-session" })).toThrow(
      AutomationSessionLockTimeoutError,
    );
    expect(fs.existsSync(path.join(tempDir, "sessions.json"))).toBe(false);
  });

  it("reclaims a stale lock whose owner process is gone", () => {
    fs.writeFileSync(path.join(tempDir, "sessions.json.lock"), JSON.stringify({
      pid: 2_147_483_647,
      ownerToken: "dead-owner",
      createdAt: "2020-01-01T00:00:00.000Z",
    }));
    const store = createPersistentAutomationSessionStore(tempDir, {
      lockTimeoutMs: 100,
      lockRetryMs: 1,
      lockStaleMs: 1,
    });

    expect(store.create({ sessionId: "recovered-session" })).toMatchObject({
      sessionId: "recovered-session",
    });
    expect(fs.existsSync(path.join(tempDir, "sessions.json.lock"))).toBe(false);
  });

  it("fails closed instead of overwriting malformed persisted JSON", () => {
    const filePath = path.join(tempDir, "sessions.json");
    fs.writeFileSync(filePath, "{not-json", "utf8");
    const store = createPersistentAutomationSessionStore(tempDir);

    expect(() => store.create({ sessionId: "replacement-session" })).toThrow(SyntaxError);
    expect(fs.readFileSync(filePath, "utf8")).toBe("{not-json");
  });

  it("does not delete a replacement lock when ownership changes", () => {
    const lockPath = path.join(tempDir, "sessions.json.lock");

    expect(() => withSessionFileLock(lockPath, {
      timeoutMs: 100,
      retryMs: 1,
      staleMs: 1,
    }, () => {
      fs.unlinkSync(lockPath);
      fs.writeFileSync(lockPath, JSON.stringify({
        pid: process.pid,
        ownerToken: "replacement-owner",
        createdAt: new Date().toISOString(),
      }));
    })).toThrow("automation session lock ownership changed before release");

    expect(JSON.parse(fs.readFileSync(lockPath, "utf8"))).toMatchObject({
      ownerToken: "replacement-owner",
    });
  });

  it("does not retry a session mutation whose business error uses EEXIST", () => {
    const lockPath = path.join(tempDir, "sessions.json.lock");
    let attempts = 0;

    expect(() => withSessionFileLock(lockPath, {
      timeoutMs: 100,
      retryMs: 1,
      staleMs: 1,
    }, () => {
      attempts += 1;
      throw Object.assign(new Error("business conflict"), { code: "EEXIST" });
    })).toThrow("business conflict");

    expect(attempts).toBe(1);
    expect(fs.existsSync(lockPath)).toBe(false);
  });
});
