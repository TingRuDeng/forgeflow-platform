import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  SessionStatus,
  createSessionStore,
  getPublicShape,
} from "../src/runtime/trae-automation-session-store.js";

describe("runtime/trae-automation-session-store", () => {
  let tempDir = "";

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-trae-session-store-"));
  });

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  it("saves sessions through the state file and reloads them without leaving a temp file behind", () => {
    const store = createSessionStore(tempDir, {
      now: () => "2026-03-30T10:00:00.000Z",
      randomUUID: () => "generated-session",
    });

    const created = store.create();
    const filePath = store.getStateFilePath();

    expect(created).toEqual({
      sessionId: "generated-session",
      status: SessionStatus.PREPARED,
      startedAt: "2026-03-30T10:00:00.000Z",
      lastActivityAt: "2026-03-30T10:00:00.000Z",
      responseDetected: false,
      error: null,
      responseText: null,
    });
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.existsSync(`${filePath}.tmp`)).toBe(false);

    const reloadedStore = createSessionStore(tempDir, {
      now: () => "2026-03-30T10:05:00.000Z",
    });
    const loaded = reloadedStore.get("generated-session");

    expect(loaded).toEqual({
      sessionId: "generated-session",
      status: SessionStatus.INTERRUPTED,
      startedAt: "2026-03-30T10:00:00.000Z",
      lastActivityAt: "2026-03-30T10:00:00.000Z",
      responseDetected: false,
      error: "Gateway restarted during execution",
      responseText: null,
    });
  });

  it("marks prepared and running sessions as interrupted after a gateway restart", () => {
    const store = createSessionStore(tempDir, {
      now: () => "2026-03-30T11:00:00.000Z",
    });

    store.create({ sessionId: "prepared-session" });
    store.create({ sessionId: "running-session" });
    store.markRunning("running-session");
    store.create({ sessionId: "completed-session" });
    store.markCompleted("completed-session", { responseText: "done" });

    const restartedStore = createSessionStore(tempDir, {
      now: () => "2026-03-30T11:10:00.000Z",
    });

    expect(restartedStore.get("prepared-session")).toMatchObject({
      sessionId: "prepared-session",
      status: SessionStatus.INTERRUPTED,
      error: "Gateway restarted during execution",
    });
    expect(restartedStore.get("running-session")).toMatchObject({
      sessionId: "running-session",
      status: SessionStatus.INTERRUPTED,
      error: "Gateway restarted during execution",
    });
    expect(restartedStore.get("completed-session")).toMatchObject({
      sessionId: "completed-session",
      status: SessionStatus.COMPLETED,
      error: null,
    });
  });

  it("prunes only expired terminal sessions with the default 24 hour ttl", () => {
    let nowValue = "2026-03-30T12:00:00.000Z";
    const store = createSessionStore(tempDir, {
      now: () => nowValue,
    });

    store.create({ sessionId: "expired-completed" });
    store.markCompleted("expired-completed", { responseText: "done" });
    store.create({ sessionId: "expired-running" });
    store.markRunning("expired-running");
    store.create({ sessionId: "recent-failed" });
    store.markFailed("recent-failed", "boom");

    const expiredCompleted = store.getInternal("expired-completed");
    const expiredRunning = store.getInternal("expired-running");
    const recentFailed = store.getInternal("recent-failed");
    if (!expiredCompleted || !expiredRunning || !recentFailed) {
      throw new Error("expected seeded sessions to exist");
    }

    expiredCompleted.updatedAt = "2026-03-29T10:59:59.999Z";
    expiredRunning.updatedAt = "2026-03-29T10:59:59.999Z";
    recentFailed.updatedAt = "2026-03-30T11:30:00.000Z";
    store.save();

    nowValue = "2026-03-30T12:00:00.000Z";
    expect(store.prune()).toBe(1);
    expect(store.get("expired-completed")).toBeNull();
    expect(store.get("expired-running")).toMatchObject({
      sessionId: "expired-running",
      status: SessionStatus.RUNNING,
    });
    expect(store.get("recent-failed")).toMatchObject({
      sessionId: "recent-failed",
      status: SessionStatus.FAILED,
    });
  });

  it("releases an existing session from the store", () => {
    const store = createSessionStore(tempDir, {
      now: () => "2026-03-30T13:00:00.000Z",
    });

    store.create({ sessionId: "release-session" });
    expect(store.release("release-session")).toBe(true);
    expect(store.get("release-session")).toBeNull();
    expect(store.release("release-session")).toBe(false);
  });

  it("getPublicShape includes responseText for read-only recovery", () => {
    const internalSession = {
      sessionId: "internal-session",
      status: SessionStatus.COMPLETED,
      startedAt: "2026-03-30T10:00:00.000Z",
      lastActivityAt: "2026-03-30T10:05:00.000Z",
      updatedAt: "2026-03-30T10:05:00.000Z",
      responseDetected: true,
      error: null,
      responseText: "secret",
      requestFingerprint: "fingerprint",
      target: { id: "target-1" },
      completedAt: "2026-03-30T10:05:00.000Z",
    };

    expect(getPublicShape(internalSession)).toEqual({
      sessionId: "internal-session",
      status: SessionStatus.COMPLETED,
      startedAt: "2026-03-30T10:00:00.000Z",
      lastActivityAt: "2026-03-30T10:05:00.000Z",
      responseDetected: true,
      error: null,
      responseText: "secret",
    });
  });
});
