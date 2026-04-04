import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, beforeEach, afterEach } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);
const sessionStoreModulePath = path.join(repoRoot, "scripts/lib/trae-automation-session-store.js");

describe("trae session store", () => {
  let tempDir: string;
  let sessionId: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "session-store-test-"));
    sessionId = "test-session-123";
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates a session with generated ID when none provided", async () => {
    const mod = await import(sessionStoreModulePath);
    const store = mod.createSessionStore(tempDir);

    const session = store.create();

    expect(session.sessionId).toBeDefined();
    expect(session.status).toBe("prepared");
    expect(session.startedAt).toBeDefined();
    expect(session.lastActivityAt).toBeDefined();
    expect(session.startedAt).toMatch(/[+-]\d{2}:\d{2}$/);
    expect(session.startedAt.endsWith("Z")).toBe(false);
    expect(session.lastActivityAt).toMatch(/[+-]\d{2}:\d{2}$/);
    expect(session.lastActivityAt.endsWith("Z")).toBe(false);
    expect(session.responseDetected).toBe(false);
    expect(session.error).toBeNull();
  });

  it("creates a session with provided ID", async () => {
    const mod = await import(sessionStoreModulePath);
    const store = mod.createSessionStore(tempDir);

    const session = store.create({ sessionId });

    expect(session.sessionId).toBe(sessionId);
    expect(session.status).toBe("prepared");
  });

  it("persists sessions to disk", async () => {
    const mod = await import(sessionStoreModulePath);
    const store = mod.createSessionStore(tempDir);

    store.create({ sessionId });
    const filePath = store.getStateFilePath();

    expect(fs.existsSync(filePath)).toBe(true);

    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(data.sessions[sessionId]).toBeDefined();
    expect(data.sessions[sessionId].status).toBe("prepared");
  });

  it("loads sessions from disk", async () => {
    const mod = await import(sessionStoreModulePath);
    
    const store1 = mod.createSessionStore(tempDir);
    store1.create({ sessionId });

    const store2 = mod.createSessionStore(tempDir);
    const loaded = store2.get(sessionId);

    expect(loaded).not.toBeNull();
    expect(loaded?.sessionId).toBe(sessionId);
    expect(loaded?.status).toBe("interrupted");
    expect(loaded?.error).toBe("Gateway restarted during execution");
  });

  it("marks non-terminal sessions as interrupted on load", async () => {
    const mod = await import(sessionStoreModulePath);
    
    const store1 = mod.createSessionStore(tempDir);
    store1.create({ sessionId });
    store1.markRunning(sessionId);

    const store2 = mod.createSessionStore(tempDir);
    const loaded = store2.get(sessionId);

    expect(loaded?.status).toBe("interrupted");
    expect(loaded?.error).toBe("Gateway restarted during execution");
  });

  it("does not mark terminal sessions as interrupted on load", async () => {
    const mod = await import(sessionStoreModulePath);
    
    const store1 = mod.createSessionStore(tempDir);
    store1.create({ sessionId });
    store1.markCompleted(sessionId, { responseText: "Done" });

    const store2 = mod.createSessionStore(tempDir);
    const loaded = store2.get(sessionId);

    expect(loaded?.status).toBe("completed");
    expect(loaded?.error).toBeNull();
  });

  it("updates session status to running", async () => {
    const mod = await import(sessionStoreModulePath);
    const store = mod.createSessionStore(tempDir);

    store.create({ sessionId });
    const updated = store.markRunning(sessionId);

    expect(updated?.status).toBe("running");
  });

  it("updates session status to completed with response text", async () => {
    const mod = await import(sessionStoreModulePath);
    const store = mod.createSessionStore(tempDir);

    store.create({ sessionId });
    const updated = store.markCompleted(sessionId, { responseText: "Final reply" });

    expect(updated?.status).toBe("completed");

    const internal = store.getInternal(sessionId);
    expect(internal?.responseText).toBe("Final reply");
    expect(internal?.completedAt).toBeDefined();
  });

  it("updates session status to failed with error", async () => {
    const mod = await import(sessionStoreModulePath);
    const store = mod.createSessionStore(tempDir);

    store.create({ sessionId });
    const updated = store.markFailed(sessionId, "Timeout exceeded");

    expect(updated?.status).toBe("failed");
    expect(updated?.error).toBe("Timeout exceeded");
  });

  it("updates responseDetected on activity touch", async () => {
    const mod = await import(sessionStoreModulePath);
    
    let tick = 0;
    const store = mod.createSessionStore(tempDir, {
      now: () => {
        tick += 1;
        return `2026-03-30T05:16:15.${String(tick).padStart(3, "0")}Z`;
      },
    });
    
    store.create({ sessionId });
    
    const before = store.get(sessionId);
    expect(before?.responseDetected).toBe(false);

    store.touchActivity(sessionId, { responseDetected: true });

    const after = store.get(sessionId);
    expect(after?.responseDetected).toBe(true);
    expect(after?.lastActivityAt).not.toBe(before?.lastActivityAt);
  });

  it("lists sessions with optional status filter", async () => {
    const mod = await import(sessionStoreModulePath);
    const store = mod.createSessionStore(tempDir);

    store.create({ sessionId: "session-1" });
    store.create({ sessionId: "session-2" });
    store.markCompleted("session-1", { responseText: "Done" });

    const all = store.list();
    expect(all.length).toBe(2);

    const completed = store.list({ status: "completed" });
    expect(completed.length).toBe(1);
    expect(completed[0].sessionId).toBe("session-1");

    const prepared = store.list({ status: "prepared" });
    expect(prepared.length).toBe(1);
    expect(prepared[0].sessionId).toBe("session-2");
  });

  it("prunes expired terminal sessions", async () => {
    const mod = await import(sessionStoreModulePath);
    
    const now = new Date("2026-03-30T10:00:00Z").toISOString();
    const store = mod.createSessionStore(tempDir, {
      now: () => now,
    });

    store.create({ sessionId: "old-session" });
    store.markCompleted("old-session", { responseText: "Done" });

    const internal = store.getInternal("old-session");
    if (internal) {
      internal.updatedAt = "2026-03-29T09:00:00Z";
      store.save();
    }

    store.create({ sessionId: "recent-session" });

    const pruned = store.prune(24 * 60 * 60 * 1000);

    expect(pruned).toBe(1);
    expect(store.get("old-session")).toBeNull();
    expect(store.get("recent-session")).not.toBeNull();
  });

  it("returns null for unknown session ID", async () => {
    const mod = await import(sessionStoreModulePath);
    const store = mod.createSessionStore(tempDir);

    const session = store.get("unknown-id");

    expect(session).toBeNull();
  });

  it("returns public shape without internal fields", async () => {
    const mod = await import(sessionStoreModulePath);
    const store = mod.createSessionStore(tempDir);

    store.create({ sessionId });
    const publicShape = store.get(sessionId);

    expect(publicShape).toHaveProperty("sessionId");
    expect(publicShape).toHaveProperty("status");
    expect(publicShape).toHaveProperty("startedAt");
    expect(publicShape).toHaveProperty("lastActivityAt");
    expect(publicShape).toHaveProperty("responseDetected");
    expect(publicShape).toHaveProperty("error");

    expect(publicShape).not.toHaveProperty("responseText");
    expect(publicShape).not.toHaveProperty("requestFingerprint");
    expect(publicShape).not.toHaveProperty("target");
    expect(publicShape).not.toHaveProperty("completedAt");
  });

  it("uses atomic writes (temp file then rename)", async () => {
    const mod = await import(sessionStoreModulePath);
    const store = mod.createSessionStore(tempDir);

    store.create({ sessionId });

    const filePath = store.getStateFilePath();
    const tempPath = `${filePath}.tmp`;

    expect(fs.existsSync(tempPath)).toBe(false);
    expect(fs.existsSync(filePath)).toBe(true);
  });
});
