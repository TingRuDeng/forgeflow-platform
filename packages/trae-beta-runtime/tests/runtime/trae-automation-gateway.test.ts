import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SessionStatus,
  createSessionStore,
} from "../../src/runtime/trae-automation-session-store.js";

describe("runtime/trae-automation-gateway", () => {
  let tempDir = "";

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-trae-gateway-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  it("returns session info through GET /v1/sessions/:id", async () => {
    const { handleTraeAutomationHttpRequest } = await import("../../src/runtime/trae-automation-gateway.js");
    const sessionStore = createSessionStore(tempDir, {
      now: () => "2026-03-30T10:00:00.000Z",
    });

    sessionStore.create({ sessionId: "session-1" });

    const result = await handleTraeAutomationHttpRequest(
      {
        method: "GET",
        pathname: "/v1/sessions/session-1",
      },
      {
        automationDriver: {} as never,
        sessionStore,
      },
    );

    expect(result.status).toBe(200);
    const successJson = result.json as { data: unknown };
    expect(successJson.data).toEqual({
      sessionId: "session-1",
      status: SessionStatus.PREPARED,
      startedAt: "2026-03-30T10:00:00.000Z",
      lastActivityAt: "2026-03-30T10:00:00.000Z",
      responseDetected: false,
      error: null,
      responseText: null,
    });
  });

  it("creates a session and marks it running through POST /v1/sessions/prepare", async () => {
    const { handleTraeAutomationHttpRequest } = await import("../../src/runtime/trae-automation-gateway.js");
    const sessionStore = createSessionStore(tempDir, {
      randomUUID: () => "prepared-session",
    });
    const automationDriver = {
      prepareSession: vi.fn(async () => ({
        status: "ok",
        preparation: { clicked: true },
      })),
    };

    const result = await handleTraeAutomationHttpRequest(
      {
        method: "POST",
        pathname: "/v1/sessions/prepare",
        body: { content: "prepare this session" },
      },
      {
        automationDriver: automationDriver as never,
        sessionStore,
      },
    );

    expect(result.status).toBe(200);
    const successJson = result.json as { data: unknown };
    expect(successJson.data).toEqual({
      status: "ok",
      preparation: { clicked: true },
      sessionId: "prepared-session",
    });
    expect(sessionStore.get("prepared-session")).toMatchObject({
      sessionId: "prepared-session",
      status: SessionStatus.RUNNING,
    });
  });

  it("touches activity and marks the session completed during POST /v1/chat", async () => {
    const { handleTraeAutomationHttpRequest } = await import("../../src/runtime/trae-automation-gateway.js");
    const timestamps = [
      "2026-03-30T10:00:00.000Z",
      "2026-03-30T10:01:00.000Z",
      "2026-03-30T10:02:00.000Z",
    ];
    let timestampIndex = 0;
    const sessionStore = createSessionStore(tempDir, {
      now: () => timestamps[Math.min(timestampIndex++, timestamps.length - 1)],
    });
    sessionStore.create({ sessionId: "chat-session" });

    const automationDriver = {
      sendPrompt: vi.fn(async () => ({
        status: "ok",
        response: { text: "Final reply" },
      })),
    };

    const result = await handleTraeAutomationHttpRequest(
      {
        method: "POST",
        pathname: "/v1/chat",
        body: {
          content: "Summarize the repository",
          sessionId: "chat-session",
        },
      },
      {
        automationDriver: automationDriver as never,
        sessionStore,
      },
    );

    expect(result.status).toBe(200);
    const updatedSession = sessionStore.get("chat-session");
    expect(updatedSession).toMatchObject({
      sessionId: "chat-session",
      status: SessionStatus.COMPLETED,
    });
    expect(updatedSession?.lastActivityAt).not.toBe("2026-03-30T10:00:00.000Z");
    expect(sessionStore.getInternal("chat-session")?.responseText).toBe("Final reply");
  });

  it("emits debug events for chat requests when debug logger is provided", async () => {
    const { handleTraeAutomationHttpRequest } = await import("../../src/runtime/trae-automation-gateway.js");
    const sessionStore = createSessionStore(tempDir);
    sessionStore.create({ sessionId: "debug-chat-session" });
    const debugLog = vi.fn();

    const automationDriver = {
      sendPrompt: vi.fn(async () => ({
        status: "ok",
        response: { text: "Final reply" },
      })),
    };

    const result = await handleTraeAutomationHttpRequest(
      {
        method: "POST",
        pathname: "/v1/chat",
        body: {
          content: "Summarize the repository",
          sessionId: "debug-chat-session",
          responseRequiredPrefix: "任务完成",
          responseTimeoutMs: 30000,
        },
      },
      {
        automationDriver: automationDriver as never,
        sessionStore,
        debugLog,
      },
    );

    expect(result.status).toBe(200);
    expect(debugLog).toHaveBeenCalledWith("request.received", expect.objectContaining({
      method: "POST",
      pathname: "/v1/chat",
    }));
    expect(debugLog).toHaveBeenCalledWith("chat.start", expect.objectContaining({
      sessionId: "debug-chat-session",
      responseRequiredPrefix: "任务完成",
    }));
    expect(debugLog).toHaveBeenCalledWith("chat.done", expect.objectContaining({
      sessionId: "debug-chat-session",
      hasResponseText: true,
    }));
  });

  it("marks the session failed when POST /v1/chat errors", async () => {
    const { handleTraeAutomationHttpRequest } = await import("../../src/runtime/trae-automation-gateway.js");
    const sessionStore = createSessionStore(tempDir);
    sessionStore.create({ sessionId: "failed-session" });

    const automationDriver = {
      sendPrompt: vi.fn(async () => {
        throw new Error("Connection refused");
      }),
    };

    const result = await handleTraeAutomationHttpRequest(
      {
        method: "POST",
        pathname: "/v1/chat",
        body: {
          content: "Summarize the repository",
          sessionId: "failed-session",
        },
      },
      {
        automationDriver: automationDriver as never,
        sessionStore,
      },
    );

    expect(result.status).toBe(502);
    expect(sessionStore.get("failed-session")).toMatchObject({
      sessionId: "failed-session",
      status: SessionStatus.FAILED,
      error: "Connection refused",
    });
  });

  it("does not mark the session failed when POST /v1/chat times out", async () => {
    const { handleTraeAutomationHttpRequest } = await import("../../src/runtime/trae-automation-gateway.js");
    const sessionStore = createSessionStore(tempDir);
    sessionStore.create({ sessionId: "timeout-session" });

    const automationDriver = {
      sendPrompt: vi.fn(async () => {
        const error = new Error("Timed out waiting for Trae to finish responding");
        (error as any).code = "AUTOMATION_RESPONSE_TIMEOUT";
        throw error;
      }),
    };

    const result = await handleTraeAutomationHttpRequest(
      {
        method: "POST",
        pathname: "/v1/chat",
        body: {
          content: "Summarize the repository",
          sessionId: "timeout-session",
        },
      },
      {
        automationDriver: automationDriver as never,
        sessionStore,
      },
    );

    expect(result.status).toBe(502);
    expect(result.json).toMatchObject({
      success: false,
      code: "AUTOMATION_RESPONSE_TIMEOUT",
    });
    const session = sessionStore.get("timeout-session");
    expect(session?.status).toBe(SessionStatus.PREPARED);
    expect(session?.error).toBeNull();
  });

  it("does not mark the session failed when error message contains timeout", async () => {
    const { handleTraeAutomationHttpRequest } = await import("../../src/runtime/trae-automation-gateway.js");
    const sessionStore = createSessionStore(tempDir);
    sessionStore.create({ sessionId: "timeout-msg-session" });

    const automationDriver = {
      sendPrompt: vi.fn(async () => {
        throw new Error("request timeout: /v1/chat");
      }),
    };

    const result = await handleTraeAutomationHttpRequest(
      {
        method: "POST",
        pathname: "/v1/chat",
        body: {
          content: "Summarize the repository",
          sessionId: "timeout-msg-session",
        },
      },
      {
        automationDriver: automationDriver as never,
        sessionStore,
      },
    );

    expect(result.status).toBe(502);
    const session = sessionStore.get("timeout-msg-session");
    expect(session?.status).toBe(SessionStatus.PREPARED);
    expect(session?.error).toBeNull();
  });

  it("releases and removes a session through POST /v1/sessions/:id/release", async () => {
    const { handleTraeAutomationHttpRequest } = await import("../../src/runtime/trae-automation-gateway.js");
    const sessionStore = createSessionStore(tempDir, {
      now: () => "2026-03-30T10:00:00.000Z",
    });
    sessionStore.create({ sessionId: "release-session" });
    sessionStore.markCompleted("release-session", {
      responseText: "Final reply",
    });

    const result = await handleTraeAutomationHttpRequest(
      {
        method: "POST",
        pathname: "/v1/sessions/release-session/release",
      },
      {
        automationDriver: {} as never,
        sessionStore,
      },
    );

    expect(result.status).toBe(200);
    expect(result.json).toEqual({
      success: true,
      code: "OK",
      data: {
        sessionId: "release-session",
        released: true,
      },
    });
    expect(sessionStore.get("release-session")).toBeNull();
  });

  it("loads and prunes a provided session store when the gateway starts", async () => {
    const { startTraeAutomationGateway } = await import("../../src/runtime/trae-automation-gateway.js");
    const server = {
      once: vi.fn(function once() {
        return server;
      }),
      listen: vi.fn((_port: number, _host: string, callback?: () => void) => {
        callback?.();
        return server;
      }),
      close: vi.fn((callback?: (error?: Error) => void) => {
        callback?.();
      }),
    };
    vi.spyOn(http, "createServer").mockReturnValue(server as never);

    const sessionStore = {
      load: vi.fn(() => new Map()),
      prune: vi.fn(() => 0),
    };

    const instance = await startTraeAutomationGateway({
      host: "127.0.0.1",
      port: 0,
      automationDriver: {} as never,
      sessionStore: sessionStore as never,
    }) as unknown as {
      sessionStore: typeof sessionStore;
      close: () => Promise<void>;
    };

    try {
      expect(sessionStore.load).toHaveBeenCalledTimes(1);
      expect(sessionStore.prune).toHaveBeenCalledTimes(1);
      expect(instance.sessionStore).toBe(sessionStore);
    } finally {
      await instance.close();
    }
  });

  it("enables the default session store when the gateway starts without one", async () => {
    vi.stubEnv("HOME", tempDir);
    vi.resetModules();
    const { startTraeAutomationGateway } = await import("../../src/runtime/trae-automation-gateway.js");
    const server = {
      once: vi.fn(function once() {
        return server;
      }),
      listen: vi.fn((_port: number, _host: string, callback?: () => void) => {
        callback?.();
        return server;
      }),
      close: vi.fn((callback?: (error?: Error) => void) => {
        callback?.();
      }),
    };
    vi.spyOn(http, "createServer").mockReturnValue(server as never);

    const instance = await startTraeAutomationGateway({
      host: "127.0.0.1",
      port: 0,
      automationDriver: {} as never,
    }) as {
      sessionStore: { getStateFilePath: () => string } | null;
      close: () => Promise<void>;
    };

    try {
      expect(instance.sessionStore).not.toBeNull();
      if (!instance.sessionStore) {
        throw new Error("expected sessionStore to be configured");
      }
      expect(instance.sessionStore.getStateFilePath()).toContain(".forgeflow-trae-beta");
    } finally {
      await instance.close();
    }
  });

  it("passes structured diagnostics through when prepareSession fails", async () => {
    const { handleTraeAutomationHttpRequest } = await import("../../src/runtime/trae-automation-gateway.js");
    const sessionStore = createSessionStore(tempDir, {
      randomUUID: () => "failed-session",
    });
    const automationDriver = {
      prepareSession: vi.fn(async () => {
        const error = new Error("Failed to prepare a fresh Trae conversation");
        (error as any).code = "AUTOMATION_PREPARE_FAILED";
        (error as any).details = {
          target: {
            id: "target-1",
            title: "ForgeFlow — task-1",
            url: "vscode-file://workbench",
          },
          diagnostics: {
            title: "ForgeFlow — task-1",
            url: "vscode-file://workbench",
            composerFound: false,
            composerSelector: null,
            sendButtonFound: false,
            sendButtonSelector: null,
            readyState: "complete",
          },
        };
        throw error;
      }),
    };

    const result = await handleTraeAutomationHttpRequest(
      {
        method: "POST",
        pathname: "/v1/sessions/prepare",
        body: { content: "prepare this session" },
      },
      {
        automationDriver: automationDriver as never,
        sessionStore,
      },
    );

    expect(result.status).toBe(502);
    const errorJson = result.json as { success: false; code: string; message: string; details: Record<string, unknown> };
    expect(errorJson.success).toBe(false);
    expect(errorJson.code).toBe("AUTOMATION_PREPARE_FAILED");
    expect(errorJson.details).toMatchObject({
      target: {
        id: "target-1",
        title: "ForgeFlow — task-1",
        url: "vscode-file://workbench",
      },
      diagnostics: {
        title: "ForgeFlow — task-1",
        url: "vscode-file://workbench",
        composerFound: false,
        composerSelector: null,
        sendButtonFound: false,
        sendButtonSelector: null,
        readyState: "complete",
      },
    });
  });
});
