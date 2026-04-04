import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createAutomationGatewayClient,
  createDispatcherClient,
  createJsonHttpClient,
} from "../../src/runtime/clients.js";

describe("runtime/clients", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("labels dispatcher fetchTask transport failures with the request source", async () => {
    const dispatcher = createDispatcherClient("http://127.0.0.1:8787", {
      fetchImpl: vi.fn(async () => {
        throw new Error("fetch failed");
      }) as never,
    });

    await expect(dispatcher.fetchTask("worker-1", "/tmp/repo")).rejects.toThrow(
      "dispatcher /api/trae/fetch-task failed: fetch failed",
    );
  });

  it("labels automation ready transport failures with the request source", async () => {
    const automation = createAutomationGatewayClient("http://127.0.0.1:8790", {
      fetchImpl: vi.fn(async () => {
        throw new Error("fetch failed");
      }) as never,
    });

    await expect(automation.ready()).rejects.toThrow(
      "automation /ready failed: fetch failed",
    );
  });

  it("labels automation chat timeouts with the request source", async () => {
    const automation = createAutomationGatewayClient("http://127.0.0.1:8790", {
      fetchImpl: vi.fn(async (_input, init) => {
        const signal = init?.signal as AbortSignal | undefined;
        await new Promise((resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
          setTimeout(resolve, 20);
        });
        return new Response("{}");
      }) as never,
    });

    await expect(
      automation.sendChat({
        content: "hello",
        timeoutMs: 5,
      }),
    ).rejects.toThrow("automation /v1/chat failed: request timeout: /v1/chat");
  });

  it("sends chatMode in sendChat request", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: { response: { text: "ok" } } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const automation = createAutomationGatewayClient("http://127.0.0.1:8790", {
      fetchImpl: fetchImpl as never,
    });

    await automation.sendChat({
      content: "test prompt",
      sessionId: "session-123",
      chatMode: "continue",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body).toMatchObject({
      content: "test prompt",
      sessionId: "session-123",
      chatMode: "continue",
    });
  });

  it("sends expectedTaskId in sendChat request", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: { response: { text: "ok" } } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const automation = createAutomationGatewayClient("http://127.0.0.1:8790", {
      fetchImpl: fetchImpl as never,
    });

    await automation.sendChat({
      content: "test prompt",
      sessionId: "session-123",
      expectedTaskId: "dispatch-151:redrive-b5240295",
    });

    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body).toMatchObject({
      content: "test prompt",
      sessionId: "session-123",
      expectedTaskId: "dispatch-151:redrive-b5240295",
    });
  });

  it("requests session status through the automation gateway", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: { status: "running" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const automation = createAutomationGatewayClient("http://127.0.0.1:8790", {
      fetchImpl: fetchImpl as never,
    });

    await expect(automation.getSession("session/123")).resolves.toEqual({ data: { status: "running" } });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:8790/v1/sessions/session%2F123",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("releases a session through the automation gateway", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: { sessionId: "session-123", released: true } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const automation = createAutomationGatewayClient("http://127.0.0.1:8790", {
      fetchImpl: fetchImpl as never,
    });

    await expect(automation.releaseSession("session/123")).resolves.toEqual({
      data: { sessionId: "session-123", released: true },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:8790/v1/sessions/session%2F123/release",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("sends discovery hints when preparing a session through the automation gateway", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: { sessionId: "session-1" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const automation = createAutomationGatewayClient("http://127.0.0.1:8790", {
      fetchImpl: fetchImpl as never,
    });

    await expect(automation.prepareSession({
      discovery: {
        titleContains: ["task-1"],
        urlContains: ["worktree"],
      },
    })).resolves.toEqual({ data: { sessionId: "session-1" } });

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:8790/v1/sessions/prepare",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          discovery: {
            titleContains: ["task-1"],
            urlContains: ["worktree"],
          },
          chatMode: "new_chat",
        }),
      }),
    );
  });

  it("uses the node transport to wait for delayed response headers", async () => {
    const client = createJsonHttpClient("http://127.0.0.1:8787", {
      sourceLabel: "manual",
      nodeRequestImpl: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          ok: true,
          status: 200,
          text: JSON.stringify({ ok: true }),
        };
      }),
    });

    await expect(client.request("/delayed", { timeoutMs: 250 })).resolves.toEqual({ ok: true });
  });

  it("uses the node transport timeout instead of waiting indefinitely for headers", async () => {
    const client = createJsonHttpClient("http://127.0.0.1:8787", {
      sourceLabel: "manual",
      nodeRequestImpl: vi.fn(async (_url, init) => {
        await new Promise((resolve) => setTimeout(resolve, Number(init.timeoutMs) + 20));
        const error = new Error("Request aborted");
        error.name = "AbortError";
        throw error;
      }),
    });

    await expect(client.request("/slow", { timeoutMs: 10 })).rejects.toThrow(
      "manual /slow failed: request timeout: /slow",
    );
  }, 1000);
});
