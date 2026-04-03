import http from "node:http";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);
const discoveryModulePath = path.join(repoRoot, "scripts/lib/trae-cdp-discovery.js");
const clientModulePath = path.join(repoRoot, "scripts/lib/trae-cdp-client.js");
const driverModulePath = path.join(repoRoot, "scripts/lib/trae-dom-driver.js");
const gatewayModulePath = path.join(repoRoot, "scripts/lib/trae-automation-gateway.js");

describe("trae cdp discovery", () => {
  it("selects the highest scoring Trae page target", async () => {
    const mod = await import(discoveryModulePath);
    const target = mod.selectTraeTarget([
      { id: "1", type: "page", title: "Other App", url: "https://example.com" },
      { id: "2", type: "page", title: "Trae", url: "https://trae.ai/chat" },
    ]);
    expect(target.id).toBe("2");
  });

  it("discovers version and target through debugger endpoints", async () => {
    const mod = await import(discoveryModulePath);
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/json/version")) {
        return {
          ok: true,
          json: async () => ({ Browser: "Trae/1.0" }),
        };
      }
      return {
        ok: true,
        json: async () => ([
          { id: "target-1", type: "page", title: "Trae", url: "https://trae.ai/chat", webSocketDebuggerUrl: "ws://debug" },
        ]),
      };
    });

    const result = await mod.discoverTraeTarget({
      fetchImpl,
      host: "127.0.0.1",
      port: 9222,
    });

    expect(result.version.Browser).toBe("Trae/1.0");
    expect(result.target.id).toBe("target-1");
  });
});

describe("trae cdp client", () => {
  it("sends CDP commands and evaluates expressions through a websocket session", async () => {
    const mod = await import(clientModulePath);

    class MockWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      readyState = MockWebSocket.CONNECTING;
      listeners = new Map<string, Array<(event: any) => void>>();

      constructor(public url: string) {
        queueMicrotask(() => {
          this.readyState = MockWebSocket.OPEN;
          this.emit("open", {});
        });
      }

      addEventListener(type: string, handler: (event: any) => void) {
        const existing = this.listeners.get(type) || [];
        existing.push(handler);
        this.listeners.set(type, existing);
      }

      emit(type: string, event: any) {
        for (const handler of this.listeners.get(type) || []) {
          handler(event);
        }
      }

      send(payload: string) {
        const message = JSON.parse(payload);
        let result: any = {};
        if (message.method === "Runtime.evaluate") {
          result = { result: { value: 42 } };
        }
        queueMicrotask(() => {
          this.emit("message", {
            data: JSON.stringify({ id: message.id, result }),
          });
        });
      }

      close() {
        this.readyState = MockWebSocket.CLOSED;
        queueMicrotask(() => {
          this.emit("close", { code: 1000, reason: "" });
        });
      }
    }

    const session = await mod.createCDPSession({
      webSocketDebuggerUrl: "ws://debugger",
      WebSocket: MockWebSocket,
    });

    const value = await session.evaluate("21 + 21");
    expect(value).toBe(42);
    await session.close();
  });
});

describe("trae dom driver", () => {
  it("builds a readiness expression that evaluates without syntax errors", async () => {
    const mod = await import(driverModulePath);
    const expression = mod.buildReadinessExpression({
      composerSelectors: [".composer"],
      sendButtonSelectors: [".send"],
    });
    class MockElement {}
    const createElement = (selector: string) => {
      const element = new MockElement();
      Object.assign(element, {
        getBoundingClientRect: () => ({ width: 100, height: 40 }),
        className: selector.slice(1),
        tagName: "DIV",
      });
      return element;
    };
    const composer = createElement(".composer");
    const send = createElement(".send");

    const result = new Function(
      "document",
      "location",
      "window",
      "Element",
      `return (${expression});`
    )(
      {
        title: "Trae",
        querySelectorAll: (selector: string) => {
          if (selector === ".composer" || selector === ".send") {
            return [selector === ".composer" ? composer : send];
          }
          return [];
        },
      },
      { href: "https://trae.ai/chat" },
      { getComputedStyle: () => ({ display: "block", visibility: "visible" }) },
      MockElement
    );

    expect(result.ready).toBe(true);
    expect(result.sendButtonFound).toBe(true);
  });

  it("reports readiness from the browser dom adapter", async () => {
    const mod = await import(driverModulePath);
    const fakeSession = { close: vi.fn(async () => {}) };
    const driver = mod.createTraeAutomationDriver({
      discoverTarget: vi.fn(async () => ({
        target: { id: "target-1", title: "Trae", url: "https://trae.ai/chat", webSocketDebuggerUrl: "ws://debug" },
      })),
      connectToTarget: vi.fn(async () => fakeSession),
      domAdapter: {
        inspectReadiness: vi.fn(async () => ({ ready: true, composerFound: true })),
      },
    });

    const readiness = await driver.getReadiness();
    expect(readiness.ready).toBe(true);
    expect(readiness.target.id).toBe("target-1");
  });

  it("prepares a session, submits a prompt, and returns the captured response", async () => {
    const mod = await import(driverModulePath);
    const fakeSession = { close: vi.fn(async () => {}) };
    const captureResponseSnapshot = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ text: "Draft reply" }])
      .mockResolvedValueOnce([{ text: "Final reply" }])
      .mockResolvedValueOnce([{ text: "Final reply" }]);
    const driver = mod.createTraeAutomationDriver({
      discoverTarget: vi.fn(async () => ({
        target: { id: "target-1", title: "Trae", url: "https://trae.ai/chat", webSocketDebuggerUrl: "ws://debug" },
      })),
      connectToTarget: vi.fn(async () => fakeSession),
      domAdapter: {
        inspectReadiness: vi.fn(async () => ({ ready: true })),
        prepareSession: vi.fn(async () => ({ ok: true, clicked: true })),
        submitPrompt: vi.fn(async () => ({ ok: true, trigger: "button" })),
        captureResponseSnapshot,
      },
      responsePollIntervalMs: 0,
      responseIdleMs: 2,
      responseTimeoutMs: 20,
      now: (() => {
        let tick = 0;
        return () => {
          tick += 1;
          return tick;
        };
      })(),
    });

    const result = await driver.sendPrompt({ content: "Summarize the repo" });
    expect(result.response.text).toBe("Final reply");
  });

  it("uses CDP Input.insertText for contenteditable composers before falling back", async () => {
    const mod = await import(driverModulePath);
    const adapter = mod.createBrowserDomAdapter();
    const send = vi.fn(async () => ({}));
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, isContentEditable: true })
      .mockResolvedValueOnce({ ok: true, composerText: "Typed by CDP", sendButtonDisabled: false });

    const result = await adapter.submitPrompt(
      { evaluate, send },
      {
        composerSelectors: [".composer"],
        sendButtonSelectors: [".send"],
      },
      { content: "OK" }
    );

    expect(send).toHaveBeenCalledWith("Input.insertText", { text: "OK" });
    expect(result.ok).toBe(true);
  });

  it("uses per-request discovery overrides when sending prompts", async () => {
    const mod = await import(driverModulePath);
    const fakeSession = { close: vi.fn(async () => {}) };
    const discoverTarget = vi.fn(async () => ({
      target: { id: "target-1", title: "Trae workspace", url: "https://trae.ai/chat", webSocketDebuggerUrl: "ws://debug" },
    }));
    const driver = mod.createTraeAutomationDriver({
      discoverTarget,
      connectToTarget: vi.fn(async () => fakeSession),
      domAdapter: {
        inspectReadiness: vi.fn(async () => ({ ready: true })),
        prepareSession: vi.fn(async () => ({ ok: true, clicked: true })),
        submitPrompt: vi.fn(async () => ({ ok: true, trigger: "button" })),
        captureResponseSnapshot: vi
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{ text: "Final reply" }])
          .mockResolvedValueOnce([{ text: "Final reply" }]),
      },
      responsePollIntervalMs: 0,
      responseIdleMs: 1,
      responseTimeoutMs: 10,
      now: (() => {
        let tick = 0;
        return () => {
          tick += 1;
          return tick;
        };
      })(),
    });

    await driver.sendPrompt({
      content: "Summarize the repo",
      discovery: { titleContains: ["openclaw-multi-agent-mvp"] },
    });

    expect(discoverTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        titleContains: ["openclaw-multi-agent-mvp"],
      })
    );
  });

  it("waits for a required response prefix before returning", async () => {
    const mod = await import(driverModulePath);
    const fakeSession = { close: vi.fn(async () => {}) };
    const driver = mod.createTraeAutomationDriver({
      discoverTarget: vi.fn(async () => ({
        target: { id: "target-1", title: "Trae", url: "https://trae.ai/chat", webSocketDebuggerUrl: "ws://debug" },
      })),
      connectToTarget: vi.fn(async () => fakeSession),
      domAdapter: {
        inspectReadiness: vi.fn(async () => ({ ready: true })),
        prepareSession: vi.fn(async () => ({ ok: true, clicked: true })),
        submitPrompt: vi.fn(async () => ({ ok: true, trigger: "button" })),
        captureResponseSnapshot: vi
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{ text: "召回上下文中" }])
          .mockResolvedValueOnce([{ text: "召回上下文中" }])
          .mockResolvedValueOnce([{ text: "## 任务完成\n- 结果: 成功" }])
          .mockResolvedValueOnce([{ text: "## 任务完成\n- 结果: 成功" }]),
      },
      responsePollIntervalMs: 0,
      responseIdleMs: 1,
      responseTimeoutMs: 20,
      now: (() => {
        let tick = 0;
        return () => {
          tick += 1;
          return tick;
        };
      })(),
    });

    const result = await driver.sendPrompt({
      content: "return final report",
      responseRequiredPrefix: "## 任务完成",
    });

    expect(result.response.text).toContain("## 任务完成");
  });

  it("normalizes rendered Trae task output before matching the required prefix", async () => {
    const mod = await import(driverModulePath);
    const fakeSession = { close: vi.fn(async () => {}) };
    const driver = mod.createTraeAutomationDriver({
      discoverTarget: vi.fn(async () => ({
        target: { id: "target-1", title: "Trae", url: "https://trae.ai/chat", webSocketDebuggerUrl: "ws://debug" },
      })),
      connectToTarget: vi.fn(async () => fakeSession),
      domAdapter: {
        inspectReadiness: vi.fn(async () => ({ ready: true })),
        prepareSession: vi.fn(async () => ({ ok: true, clicked: true })),
        submitPrompt: vi.fn(async () => ({ ok: true, trigger: "button" })),
        captureResponseSnapshot: vi
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{
            text: "SOLO Coder\n思考过程\n任务完成\n结果: 成功\n任务ID: dispatch-1:task-1\n备注: 无\n任务完成\n9%",
          }])
          .mockResolvedValueOnce([{
            text: "SOLO Coder\n思考过程\n任务完成\n结果: 成功\n任务ID: dispatch-1:task-1\n备注: 无\n任务完成\n9%",
          }]),
      },
      responsePollIntervalMs: 0,
      responseIdleMs: 1,
      responseTimeoutMs: 20,
      now: (() => {
        let tick = 0;
        return () => {
          tick += 1;
          return tick;
        };
      })(),
    });

    const result = await driver.sendPrompt({
      content: "return final report",
      responseRequiredPrefix: "任务完成",
    });

    expect(result.response.text).toBe("任务完成\n结果: 成功\n任务ID: dispatch-1:task-1\n备注: 无");
  });

  it("matches responseRequiredPrefix against markdown headings stripped from the final reply", async () => {
    const mod = await import(driverModulePath);
    const fakeSession = { close: vi.fn(async () => {}) };
    const driver = mod.createTraeAutomationDriver({
      discoverTarget: vi.fn(async () => ({
        target: { id: "target-1", title: "Trae", url: "https://trae.ai/chat", webSocketDebuggerUrl: "ws://debug" },
      })),
      connectToTarget: vi.fn(async () => fakeSession),
      domAdapter: {
        inspectReadiness: vi.fn(async () => ({ ready: true })),
        prepareSession: vi.fn(async () => ({ ok: true, clicked: true })),
        submitPrompt: vi.fn(async () => ({ ok: true, trigger: "button" })),
        captureResponseSnapshot: vi
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{ text: "## 任务完成\n- 结果: 成功\n- 任务ID: dispatch-1:task-1\n- 备注: 无" }])
          .mockResolvedValueOnce([{ text: "## 任务完成\n- 结果: 成功\n- 任务ID: dispatch-1:task-1\n- 备注: 无" }]),
      },
      responsePollIntervalMs: 0,
      responseIdleMs: 1,
      responseTimeoutMs: 20,
      now: (() => {
        let tick = 0;
        return () => {
          tick += 1;
          return tick;
        };
      })(),
    });

    const result = await driver.sendPrompt({
      content: "return final report",
      responseRequiredPrefix: "任务完成",
    });

    expect(result.response.text).toContain("## 任务完成");
  });

  it("prefers the final reply over planning cards when both are present", async () => {
    const mod = await import(driverModulePath);
    const extracted = mod.extractAutomationResponse(
      [
        { text: "SOLO Coder\n思考过程\n切换到 worktree 目录并检查状态\n0/5 已完成" },
        { text: "## 任务完成\n- 结果: 成功\n- 任务ID: dispatch-4:task-1\n- 备注: 无" },
      ],
      [],
      { requiredPrefix: "任务完成" },
    );

    expect(extracted.source).toBe("new_nodes");
    expect(extracted.text).toContain("## 任务完成");
    expect(extracted.text).not.toContain("SOLO Coder");
  });

  it("emits response capture debug logs on timeout when debug is enabled", async () => {
    const mod = await import(driverModulePath);
    const fakeSession = { close: vi.fn(async () => {}) };
    const logger = { warn: vi.fn() };
    const driver = mod.createTraeAutomationDriver({
      discoverTarget: vi.fn(async () => ({
        target: { id: "target-1", title: "Trae", url: "https://trae.ai/chat", webSocketDebuggerUrl: "ws://debug" },
      })),
      connectToTarget: vi.fn(async () => fakeSession),
      logger,
      debug: true,
      domAdapter: {
        inspectReadiness: vi.fn(async () => ({ ready: true })),
        prepareSession: vi.fn(async () => ({ ok: true, clicked: true })),
        submitPrompt: vi.fn(async () => ({ ok: true, trigger: "button" })),
        captureResponseSnapshot: vi.fn(async () => [{ text: "思考中" }]),
      },
      responsePollIntervalMs: 0,
      responseIdleMs: 1,
      responseTimeoutMs: 5,
      now: (() => {
        let tick = 0;
        return () => {
          tick += 1;
          return tick;
        };
      })(),
    });

    await expect(driver.sendPrompt({
      content: "return final report",
      responseRequiredPrefix: "任务完成",
    })).rejects.toThrow("Timed out waiting for Trae to finish responding");

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("[trae-automation-debug] response timeout"));
  });
});

describe("trae automation gateway", () => {
  it("returns readiness through GET /ready", async () => {
    const mod = await import(gatewayModulePath);
    const automationDriver = {
      getReadiness: vi.fn(async () => ({ ready: true, mode: "cdp" })),
    };

    const result = await mod.handleTraeAutomationHttpRequest(
      { method: "GET", pathname: "/ready" },
      { automationDriver }
    );

    expect(result.status).toBe(200);
    expect(result.json.data.ready).toBe(true);
  });

  it("passes discovery hints through GET /ready query params", async () => {
    const mod = await import(gatewayModulePath);
    const automationDriver = {
      getReadiness: vi.fn(async () => ({ ready: true, mode: "cdp" })),
    };

    await mod.handleTraeAutomationHttpRequest(
      {
        method: "GET",
        pathname: "/ready",
        query: { title_contains: "openclaw-multi-agent-mvp,.worktrees-task-1" },
      },
      { automationDriver }
    );

    expect(automationDriver.getReadiness).toHaveBeenCalledWith({
      discovery: {
        titleContains: ["openclaw-multi-agent-mvp", ".worktrees-task-1"],
      },
    });
  });

  it("sends prompts through POST /v1/chat", async () => {
    const mod = await import(gatewayModulePath);
    const automationDriver = {
      sendPrompt: vi.fn(async () => ({
        status: "ok",
        response: { text: "Repository summary" },
      })),
    };

    const result = await mod.handleTraeAutomationHttpRequest(
      {
        method: "POST",
        pathname: "/v1/chat",
        body: {
          content: "Summarize the repository",
          discovery: { titleContains: ["openclaw-multi-agent-mvp"] },
          responseRequiredPrefix: "## 任务完成",
          responseTimeoutMs: 120000,
        },
      },
      { automationDriver }
    );

    expect(result.status).toBe(200);
    expect(result.json.data.response.text).toBe("Repository summary");
    expect(automationDriver.sendPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        discovery: { titleContains: ["openclaw-multi-agent-mvp"] },
        responseRequiredPrefix: "## 任务完成",
        responseTimeoutMs: 120000,
      })
    );
  });

  it("returns 502 when automation send fails", async () => {
    const mod = await import(gatewayModulePath);
    const automationDriver = {
      sendPrompt: vi.fn(async () => {
        throw Object.assign(new Error("Selectors missing"), {
          code: "AUTOMATION_SELECTOR_NOT_READY",
          details: { composerFound: false },
        });
      }),
    };

    const result = await mod.handleTraeAutomationHttpRequest(
      {
        method: "POST",
        pathname: "/v1/chat",
        body: { content: "Summarize the repository" },
      },
      { automationDriver }
    );

    expect(result.status).toBe(502);
    expect(result.json.code).toBe("AUTOMATION_SELECTOR_NOT_READY");
  });

  it("returns session info through GET /v1/sessions/:id", async () => {
    const mod = await import(gatewayModulePath);
    const sessionStoreModule = await import(
      path.join(repoRoot, "scripts/lib/trae-automation-session-store.js")
    );

    const sessionStore = sessionStoreModule.createSessionStore(null);
    const session = sessionStore.create({ sessionId: "test-session-123" });

    const result = await mod.handleTraeAutomationHttpRequest(
      { method: "GET", pathname: "/v1/sessions/test-session-123" },
      { sessionStore }
    );

    expect(result.status).toBe(200);
    expect(result.json.data.sessionId).toBe("test-session-123");
    expect(result.json.data.status).toBe("prepared");
  });

  it("returns 404 for unknown session ID", async () => {
    const mod = await import(gatewayModulePath);
    const sessionStoreModule = await import(
      path.join(repoRoot, "scripts/lib/trae-automation-session-store.js")
    );

    const sessionStore = sessionStoreModule.createSessionStore(null);

    await expect(
      mod.handleTraeAutomationHttpRequest(
        { method: "GET", pathname: "/v1/sessions/unknown-id" },
        { sessionStore }
      )
    ).rejects.toThrow("Session unknown-id not found");
  });

  it("creates session on POST /v1/sessions/prepare with sessionStore", async () => {
    const mod = await import(gatewayModulePath);
    const sessionStoreModule = await import(
      path.join(repoRoot, "scripts/lib/trae-automation-session-store.js")
    );

    const sessionStore = sessionStoreModule.createSessionStore(null);
    const automationDriver = {
      prepareSession: vi.fn(async () => ({
        status: "ok",
        preparation: { clicked: true },
      })),
    };

    const result = await mod.handleTraeAutomationHttpRequest(
      {
        method: "POST",
        pathname: "/v1/sessions/prepare",
        body: { content: "test prompt" },
      },
      { automationDriver, sessionStore }
    );

    expect(result.status).toBe(200);
    expect(result.json.data.sessionId).toBeDefined();
    expect(result.json.data.status).toBe("ok");

    const session = sessionStore.get(result.json.data.sessionId);
    expect(session).not.toBeNull();
    expect(session?.status).toBe("prepared");
  });

  it("updates session status during POST /v1/chat", async () => {
    const mod = await import(gatewayModulePath);
    const sessionStoreModule = await import(
      path.join(repoRoot, "scripts/lib/trae-automation-session-store.js")
    );

    const sessionStore = sessionStoreModule.createSessionStore(null);
    const session = sessionStore.create({ sessionId: "test-session-456" });

    const automationDriver = {
      sendPrompt: vi.fn(async () => ({
        status: "ok",
        response: { text: "Final reply" },
      })),
    };

    const result = await mod.handleTraeAutomationHttpRequest(
      {
        method: "POST",
        pathname: "/v1/chat",
        body: {
          content: "Summarize the repository",
          sessionId: "test-session-456",
        },
      },
      { automationDriver, sessionStore }
    );

    expect(result.status).toBe(200);

    const updatedSession = sessionStore.get("test-session-456");
    expect(updatedSession?.status).toBe("completed");

    const internalSession = sessionStore.getInternal("test-session-456");
    expect(internalSession?.responseText).toBe("Final reply");
  });

  it("returns cached response for completed session", async () => {
    const mod = await import(gatewayModulePath);
    const sessionStoreModule = await import(
      path.join(repoRoot, "scripts/lib/trae-automation-session-store.js")
    );

    const sessionStore = sessionStoreModule.createSessionStore(null);
    sessionStore.create({ sessionId: "test-session-789" });
    sessionStore.markCompleted("test-session-789", { responseText: "Cached reply" });

    const automationDriver = {
      sendPrompt: vi.fn(async () => ({
        status: "ok",
        response: { text: "New reply" },
      })),
    };

    const result = await mod.handleTraeAutomationHttpRequest(
      {
        method: "POST",
        pathname: "/v1/chat",
        body: {
          content: "Summarize the repository",
          sessionId: "test-session-789",
        },
      },
      { automationDriver, sessionStore }
    );

    expect(result.status).toBe(200);
    expect(result.json.data.response.text).toBe("Cached reply");
    expect(result.json.data.cached).toBe(true);
    expect(automationDriver.sendPrompt).not.toHaveBeenCalled();
  });

  it("marks session as failed on error", async () => {
    const mod = await import(gatewayModulePath);
    const sessionStoreModule = await import(
      path.join(repoRoot, "scripts/lib/trae-automation-session-store.js")
    );

    const sessionStore = sessionStoreModule.createSessionStore(null);
    sessionStore.create({ sessionId: "test-session-error" });

    const automationDriver = {
      sendPrompt: vi.fn(async () => {
        throw new Error("Connection refused");
      }),
    };

    const result = await mod.handleTraeAutomationHttpRequest(
      {
        method: "POST",
        pathname: "/v1/chat",
        body: {
          content: "Summarize the repository",
          sessionId: "test-session-error",
        },
      },
      { automationDriver, sessionStore }
    );

    expect(result.status).toBe(502);

    const updatedSession = sessionStore.get("test-session-error");
    expect(updatedSession?.status).toBe("failed");
    expect(updatedSession?.error).toBe("Connection refused");
  });

  it("does not mark session as failed on soft-timeout error", async () => {
    const mod = await import(gatewayModulePath);
    const sessionStoreModule = await import(
      path.join(repoRoot, "scripts/lib/trae-automation-session-store.js")
    );

    const sessionStore = sessionStoreModule.createSessionStore(null);
    sessionStore.create({ sessionId: "test-session-timeout" });

    const automationDriver = {
      sendPrompt: vi.fn(async () => {
        const error = new Error("Timed out waiting for Trae to finish responding") as Error & {
          code?: string;
        };
        error.code = "AUTOMATION_RESPONSE_TIMEOUT";
        throw error;
      }),
    };

    const result = await mod.handleTraeAutomationHttpRequest(
      {
        method: "POST",
        pathname: "/v1/chat",
        body: {
          content: "Summarize the repository",
          sessionId: "test-session-timeout",
        },
      },
      { automationDriver, sessionStore }
    );

    expect(result.status).toBe(502);
    const updatedSession = sessionStore.get("test-session-timeout");
    expect(updatedSession?.status).toBe("running");
    expect(updatedSession?.error).toBe(null);
  });

  it("enables session store by default for started gateway instances", async () => {
    const mod = await import(gatewayModulePath);
    const createServerSpy = vi.spyOn(http, "createServer").mockImplementation(() => {
      const server = {
        once: vi.fn(function once() {
          return server;
        }),
        listen: vi.fn((_port, _host, callback) => {
          callback?.();
          return server;
        }),
        close: vi.fn((callback) => {
          callback?.();
        }),
      };
      return server as any;
    });
    const instance = await mod.startTraeAutomationGateway({
      host: "127.0.0.1",
      port: 0,
      automationDriver: {
        ready: vi.fn(async () => ({ ready: true })),
        prepareSession: vi.fn(async () => ({ status: "ok", preparation: { clicked: true } })),
        sendPrompt: vi.fn(async () => ({ status: "ok", response: { text: "Test response" } })),
      },
    });

    try {
      expect(instance.sessionStore).not.toBeNull();
      expect(typeof instance.sessionStore.create).toBe("function");
    } finally {
      createServerSpy.mockRestore();
      await instance.close();
    }
  });

  it("allows explicitly disabling the session store for started gateway instances", async () => {
    const mod = await import(gatewayModulePath);
    const createServerSpy = vi.spyOn(http, "createServer").mockImplementation(() => {
      const server = {
        once: vi.fn(function once() {
          return server;
        }),
        listen: vi.fn((_port, _host, callback) => {
          callback?.();
          return server;
        }),
        close: vi.fn((callback) => {
          callback?.();
        }),
      };
      return server as any;
    });
    const instance = await mod.startTraeAutomationGateway({
      host: "127.0.0.1",
      port: 0,
      sessionStore: null,
      automationDriver: {
        ready: vi.fn(async () => ({ ready: true })),
        prepareSession: vi.fn(async () => ({ status: "ok", preparation: { clicked: true } })),
        sendPrompt: vi.fn(async () => ({ status: "ok", response: { text: "Test response" } })),
      },
    });

    try {
      expect(instance.sessionStore).toBeNull();
    } finally {
      createServerSpy.mockRestore();
      await instance.close();
    }
  });
});
