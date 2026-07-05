import { describe, expect, it, vi } from "vitest";

import {
  ApiError,
  handleAutomationGatewayRequest,
  isTimeoutError,
  parseDiscoveryFromQuery,
  type AutomationGatewaySessionStore,
} from "../src/index.js";

function createMemorySessionStore(): AutomationGatewaySessionStore {
  const sessions = new Map<string, any>();
  return {
    create(params = {}) {
      const session = {
        sessionId: params.sessionId || "generated-session",
        status: "prepared",
        requestFingerprint: params.requestFingerprint || null,
        responseText: null,
        responseDetected: false,
        error: null,
      };
      sessions.set(session.sessionId, session);
      return { ...session };
    },
    get(sessionId) {
      const session = sessions.get(sessionId);
      return session ? { ...session } : null;
    },
    getInternal(sessionId) {
      return sessions.get(sessionId) || null;
    },
    markRunning(sessionId) {
      const session = sessions.get(sessionId);
      if (!session) {
        return null;
      }
      session.status = "running";
      return { ...session };
    },
    markCompleted(sessionId, result) {
      const session = sessions.get(sessionId);
      if (!session) {
        return null;
      }
      session.status = "completed";
      session.responseText = result.responseText;
      return { ...session };
    },
    markFailed(sessionId, error) {
      const session = sessions.get(sessionId);
      if (!session) {
        return null;
      }
      session.status = "failed";
      session.error = error;
      return { ...session };
    },
    release(sessionId) {
      return sessions.delete(sessionId);
    },
    touchActivity(sessionId, details = {}) {
      const session = sessions.get(sessionId);
      if (!session) {
        return null;
      }
      session.responseDetected = details.responseDetected ?? session.responseDetected;
      return { ...session };
    },
  };
}

describe("automation-gateway-core/gateway-handler", () => {
  it("parses discovery query hints", () => {
    expect(parseDiscoveryFromQuery({
      title_contains: "ForgeFlow,.worktrees",
      url_contains: "trae.ai",
    })).toEqual({
      titleContains: ["ForgeFlow", ".worktrees"],
      urlContains: ["trae.ai"],
    });
  });

  it("handles cached chat sessions without calling the driver", async () => {
    const sessionStore = createMemorySessionStore();
    sessionStore.create({ sessionId: "cached-session" });
    sessionStore.markCompleted("cached-session", { responseText: "Cached reply" });
    const sendPrompt = vi.fn();

    const result = await handleAutomationGatewayRequest(
      {
        method: "POST",
        pathname: "/v1/chat",
        body: {
          content: "Summarize",
          sessionId: "cached-session",
        },
      },
      {
        automationDriver: {
          getReadiness: vi.fn(),
          prepareSession: vi.fn(),
          sendPrompt,
        },
        sessionStore,
      },
    );

    expect(result.status).toBe(200);
    expect((result.json as { data: { cached?: boolean; response?: { text?: string } } }).data.cached).toBe(true);
    expect((result.json as { data: { response?: { text?: string } } }).data.response?.text).toBe("Cached reply");
    expect(sendPrompt).not.toHaveBeenCalled();
  });

  it("rejects running session reuse before calling the driver", async () => {
    const sessionStore = createMemorySessionStore();
    sessionStore.create({ sessionId: "running-session" });
    sessionStore.markRunning("running-session");
    const sendPrompt = vi.fn();

    await expect(handleAutomationGatewayRequest(
      {
        method: "POST",
        pathname: "/v1/chat",
        body: {
          content: "Summarize",
          sessionId: "running-session",
        },
      },
      {
        automationDriver: {
          getReadiness: vi.fn(),
          prepareSession: vi.fn(),
          sendPrompt,
        },
        sessionStore,
      },
    )).rejects.toMatchObject({
      code: "SESSION_CONFLICT",
      statusCode: 409,
    });
    expect(sendPrompt).not.toHaveBeenCalled();
  });

  it("normalizes automation request errors and keeps timeout sessions running", async () => {
    const sessionStore = createMemorySessionStore();
    sessionStore.create({ sessionId: "timeout-session" });
    const timeoutError = Object.assign(new Error("Timed out waiting for Trae to finish responding"), {
      code: "AUTOMATION_RESPONSE_TIMEOUT",
    });

    const result = await handleAutomationGatewayRequest(
      {
        method: "POST",
        pathname: "/v1/chat",
        body: {
          content: "Summarize",
          sessionId: "timeout-session",
        },
      },
      {
        automationDriver: {
          getReadiness: vi.fn(),
          prepareSession: vi.fn(),
          sendPrompt: vi.fn(async () => {
            throw timeoutError;
          }),
        },
        sessionStore,
        normalizeAutomationError: (error, fallbackCode) => ({
          code: (error as { code?: string }).code || fallbackCode,
          message: error instanceof Error ? error.message : "failed",
          details: {},
        }),
      },
    );

    expect(result.status).toBe(502);
    expect((result.json as { code: string }).code).toBe("AUTOMATION_RESPONSE_TIMEOUT");
    expect(sessionStore.get("timeout-session")?.status).toBe("running");
    expect(isTimeoutError(timeoutError)).toBe(true);
  });

  it("exposes ApiError for adapter-level HTTP error writers", () => {
    const error = new ApiError("BAD_REQUEST", "bad request", 400, { field: "content" });

    expect(error.code).toBe("BAD_REQUEST");
    expect(error.statusCode).toBe(400);
    expect(error.details).toEqual({ field: "content" });
  });
});
