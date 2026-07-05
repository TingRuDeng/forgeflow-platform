import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AutomationSessionStatus,
  createPersistentAutomationSessionStore,
  getAutomationSessionPublicShape,
} from "../src/index.js";

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
});
