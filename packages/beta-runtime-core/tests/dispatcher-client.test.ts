import { afterEach, describe, expect, it, vi } from "vitest";

import { createDispatcherClient } from "../src/runtime/dispatcher-client.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("dispatcher client heartbeat retry", () => {
  it("fails before sending when the worker token is whitespace", async () => {
    const originalToken = process.env.DISPATCHER_WORKER_TOKEN;
    process.env.DISPATCHER_WORKER_TOKEN = "   ";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = createDispatcherClient("http://127.0.0.1:8787");

    try {
      await expect(client.heartbeat("worker-heartbeat", {
        at: "2026-08-01T00:00:00.000Z",
      })).rejects.toThrow(/DISPATCHER_WORKER_TOKEN.*non-empty/i);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      if (originalToken === undefined) {
        delete process.env.DISPATCHER_WORKER_TOKEN;
      } else {
        process.env.DISPATCHER_WORKER_TOKEN = originalToken;
      }
    }
  });

  it("retries a transient heartbeat failure with the same payload", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{"error":"temporarily unavailable"}', {
        status: 503,
      }))
      .mockResolvedValueOnce(new Response('{"status":"heartbeat_recorded"}', {
        status: 200,
      }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createDispatcherClient("http://127.0.0.1:8787");
    const payload = { at: "2026-08-01T00:00:00.000Z" };

    const pending = client.heartbeat("worker-heartbeat", payload);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(pending).resolves.toEqual({ status: "heartbeat_recorded" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([, init]) => init.body)).toEqual([
      JSON.stringify(payload),
      JSON.stringify(payload),
    ]);
  });

  it.each([401, 409])("does not retry a permanent heartbeat HTTP %s", async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      '{"error":"permanent heartbeat failure"}',
      { status },
    ));
    vi.stubGlobal("fetch", fetchMock);
    const client = createDispatcherClient("http://127.0.0.1:8787");

    await expect(client.heartbeat("worker-heartbeat", {
      at: "2026-08-01T00:00:00.000Z",
    })).rejects.toMatchObject({ status });

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("stops heartbeat after exactly four transient attempts", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(async () => new Response(
      '{"error":"temporarily unavailable"}',
      { status: 503 },
    ));
    vi.stubGlobal("fetch", fetchMock);
    const client = createDispatcherClient("http://127.0.0.1:8787");

    const pending = client.heartbeat("worker-heartbeat", {
      at: "2026-08-01T00:00:00.000Z",
    });
    const settled = pending.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(3_000);

    await expect(settled).resolves.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("does not retry a successful response with invalid JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("not-json", {
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createDispatcherClient("http://127.0.0.1:8787");

    await expect(client.heartbeat("worker-heartbeat", {
      at: "2026-08-01T00:00:00.000Z",
    })).rejects.toMatchObject({ name: "DispatcherResponseError", retryable: false });

    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
