import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createAutomationGatewayClient,
  createDispatcherClient,
  createJsonHttpClient,
} from "../../src/runtime/clients.js";

const originalDispatcherApiToken = process.env.DISPATCHER_API_TOKEN;
const originalDispatcherWorkerToken = process.env.DISPATCHER_WORKER_TOKEN;
const originalProgressMaxAttempts = process.env.WORKER_PROGRESS_MAX_ATTEMPTS;
const originalProgressRetryDelayMs = process.env.WORKER_PROGRESS_RETRY_DELAY_MS;

describe("runtime/clients", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (originalDispatcherApiToken === undefined) {
      delete process.env.DISPATCHER_API_TOKEN;
    } else {
      process.env.DISPATCHER_API_TOKEN = originalDispatcherApiToken;
    }
    if (originalDispatcherWorkerToken === undefined) {
      delete process.env.DISPATCHER_WORKER_TOKEN;
    } else {
      process.env.DISPATCHER_WORKER_TOKEN = originalDispatcherWorkerToken;
    }
    if (originalProgressMaxAttempts === undefined) {
      delete process.env.WORKER_PROGRESS_MAX_ATTEMPTS;
    } else {
      process.env.WORKER_PROGRESS_MAX_ATTEMPTS = originalProgressMaxAttempts;
    }
    if (originalProgressRetryDelayMs === undefined) {
      delete process.env.WORKER_PROGRESS_RETRY_DELAY_MS;
    } else {
      process.env.WORKER_PROGRESS_RETRY_DELAY_MS = originalProgressRetryDelayMs;
    }
  });

  it("prefers the worker-scoped dispatcher token", async () => {
    process.env.DISPATCHER_API_TOKEN = "operator-token";
    process.env.DISPATCHER_WORKER_TOKEN = "worker-token";
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const dispatcher = createDispatcherClient("http://127.0.0.1:8787", {
      fetchImpl: fetchImpl as never,
    });

    await dispatcher.register({
      workerId: "trae-worker",
      pool: "trae",
      repoDir: "/tmp/repo",
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/api/trae/register",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer worker-token",
        }),
      }),
    );
  });

  it("fails before sending instead of falling back from a whitespace worker token", async () => {
    process.env.DISPATCHER_API_TOKEN = "operator-token";
    process.env.DISPATCHER_WORKER_TOKEN = "   ";
    const fetchImpl = vi.fn();
    const dispatcher = createDispatcherClient("http://127.0.0.1:8787", {
      fetchImpl: fetchImpl as never,
    });

    await expect(dispatcher.register({
      workerId: "trae-worker",
      pool: "trae",
      repoDir: "/tmp/repo",
    })).rejects.toThrow(/DISPATCHER_WORKER_TOKEN.*non-empty/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects an explicit whitespace dispatcher token before sending", async () => {
    delete process.env.DISPATCHER_API_TOKEN;
    delete process.env.DISPATCHER_WORKER_TOKEN;
    const fetchImpl = vi.fn();
    const dispatcher = createDispatcherClient("http://127.0.0.1:8787", {
      dispatcherToken: "   ",
      fetchImpl: fetchImpl as never,
    });

    await expect(dispatcher.register({
      workerId: "trae-worker",
      pool: "trae",
      repoDir: "/tmp/repo",
    })).rejects.toThrow(/Trae dispatcherToken option.*non-empty/i);
    expect(fetchImpl).not.toHaveBeenCalled();
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

  it("propagates caller cancellation into dispatcher result delivery", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async (_input, init) => {
      const signal = init?.signal as AbortSignal | undefined;
      await new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        controller.abort();
      });
      return new Response("{}");
    });
    const dispatcher = createDispatcherClient("http://127.0.0.1:8787", {
      fetchImpl: fetchImpl as never,
    });

    await expect(dispatcher.submitResult({
      taskId: "task-aborted",
      status: "failed",
      summary: "cancelled",
      testOutput: "",
      risks: [],
      filesChanged: [],
    }, { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
      message: "dispatcher /api/trae/submit-result failed: request aborted",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.signal?.aborted).toBe(true);
  });

  it("propagates caller cancellation into dispatcher startTask", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async (_input, init) => {
      const signal = init?.signal as AbortSignal | undefined;
      await new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
        controller.abort();
      });
      return new Response("{}");
    });
    const dispatcher = createDispatcherClient("http://127.0.0.1:8787", {
      fetchImpl: fetchImpl as never,
    });

    await expect(dispatcher.startTask(
      "trae-cancel",
      "task-start-cancel",
      {
        attemptId: "attempt-start-cancel",
        leaseToken: "lease-start-cancel",
        protocolVersion: "2026-05-v1",
        traceId: "trace-start-cancel",
        idempotencyKey: "worker-v1:task-start-cancel:attempt-start-cancel",
      },
      { signal: controller.signal },
    )).rejects.toMatchObject({ name: "AbortError" });

    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("sends evidence in submitResult request", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const dispatcher = createDispatcherClient("http://127.0.0.1:8787", {
      fetchImpl: fetchImpl as never,
    });

    await dispatcher.submitResult({
      taskId: "task-1",
      attemptId: "attempt-1",
      leaseToken: "lease-token-1",
      protocolVersion: "2026-05-v1",
      traceId: "trace-1",
      idempotencyKey: "worker-v1:task-1:attempt-1",
      status: "failed",
      summary: "pnpm test failed",
      testOutput: "FAIL",
      risks: [],
      filesChanged: [],
      github: {
        branchName: null,
        commitSha: null,
        pushStatus: "not_attempted",
        pushError: null,
        prNumber: null,
        prUrl: null,
      },
      evidence: {
        failureType: "verification",
        failureSummary: "pnpm test failed",
        blockers: [],
        findings: [],
      },
      artifactBundle: {
        bundleId: "attempt-1:artifact-bundle",
        taskId: "task-1",
        attemptId: "attempt-1",
        schemaVersion: "artifact-bundle/v1",
        summary: "pnpm test failed",
        changedFiles: [],
        refs: { structuredReport: "artifact://attempt-1/result.json" },
      },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body).toMatchObject({
      task_id: "task-1",
      attempt_id: "attempt-1",
      lease_token: "lease-token-1",
      protocol_version: "2026-05-v1",
      trace_id: "trace-1",
      idempotency_key: "worker-v1:task-1:attempt-1",
      status: "failed",
      summary: "pnpm test failed",
      evidence: {
        failureType: "verification",
        failureSummary: "pnpm test failed",
        blockers: [],
        findings: [],
      },
      artifact_bundle: {
        bundleId: "attempt-1:artifact-bundle",
        taskId: "task-1",
        attemptId: "attempt-1",
      },
    });
  });

  it("sends attempt lease data in startTask request", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const dispatcher = createDispatcherClient("http://127.0.0.1:8787", {
      fetchImpl: fetchImpl as never,
    });

    await dispatcher.startTask("trae-1", "task-1", {
      attemptId: "attempt-1",
      leaseToken: "lease-token-1",
      protocolVersion: "2026-05-v1",
      traceId: "trace-1",
      idempotencyKey: "worker-v1:task-1:attempt-1",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body).toMatchObject({
      worker_id: "trae-1",
      task_id: "task-1",
      attempt_id: "attempt-1",
      lease_token: "lease-token-1",
      protocol_version: "2026-05-v1",
      trace_id: "trace-1",
      idempotency_key: "worker-v1:task-1:attempt-1",
    });
  });

  it("reports progress through the fenced worker endpoint using the fetched attempt envelope", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: "ok",
        task: {
          task_id: "task-progress",
          attempt_id: "attempt-progress",
          lease_token: "lease-progress",
          protocol_version: "2026-05-v1",
          trace_id: "trace-progress",
          idempotency_key: "worker-v1:task-progress:attempt-progress",
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "progress_recorded" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    const dispatcher = createDispatcherClient("http://127.0.0.1:8787", {
      fetchImpl: fetchImpl as never,
    });

    await dispatcher.fetchTask("trae-progress", "/tmp/repo");
    await dispatcher.reportProgress("task-progress", "Running tests", "trae-progress");

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, init] = fetchImpl.mock.calls[1] as unknown as [string, { body: string }];
    expect(url).toBe("http://127.0.0.1:8787/api/workers/trae-progress/progress");
    expect(JSON.parse(init.body)).toMatchObject({
      taskId: "task-progress",
      attemptId: "attempt-progress",
      leaseToken: "lease-progress",
      protocolVersion: "2026-05-v1",
      traceId: "trace-progress",
      idempotencyKey: "worker-v1:task-progress:attempt-progress",
      progressId: expect.any(String),
      message: "Running tests",
    });
  });

  it("retries Trae progress with one stable generated progressId", async () => {
    process.env.WORKER_PROGRESS_MAX_ATTEMPTS = "3";
    process.env.WORKER_PROGRESS_RETRY_DELAY_MS = "0";
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: "ok",
        task: {
          task_id: "task-progress-retry",
          attempt_id: "attempt-progress-retry",
          lease_token: "lease-progress-retry",
          protocol_version: "2026-05-v1",
          trace_id: "trace-progress-retry",
          idempotency_key: "worker-v1:task-progress-retry:attempt-progress-retry",
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response('{"error":"temporarily unavailable"}', { status: 503 }))
      .mockResolvedValueOnce(new Response('{"status":"progress_recorded"}', { status: 200 }));
    const dispatcher = createDispatcherClient("http://127.0.0.1:8787", {
      fetchImpl: fetchImpl as never,
    });

    await dispatcher.fetchTask("trae-progress", "/tmp/repo");
    await dispatcher.reportProgress("task-progress-retry", "Running tests", "trae-progress");

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const firstAttempt = JSON.parse((fetchImpl.mock.calls[1] as unknown as [string, { body: string }])[1].body);
    const secondAttempt = JSON.parse((fetchImpl.mock.calls[2] as unknown as [string, { body: string }])[1].body);
    expect(secondAttempt).toEqual(firstAttempt);
    expect(firstAttempt.progressId).toEqual(expect.any(String));
  });

  it("does not retry a Trae progress lease conflict", async () => {
    process.env.WORKER_PROGRESS_RETRY_DELAY_MS = "0";
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: "ok",
        task: {
          task_id: "task-progress-conflict",
          attempt_id: "attempt-progress-conflict",
          lease_token: "lease-progress-conflict",
          protocol_version: "2026-05-v1",
          trace_id: "trace-progress-conflict",
          idempotency_key: "worker-v1:task-progress-conflict:attempt-progress-conflict",
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response("null", { status: 409 }));
    const dispatcher = createDispatcherClient("http://127.0.0.1:8787", {
      fetchImpl: fetchImpl as never,
    });

    await dispatcher.fetchTask("trae-progress", "/tmp/repo");
    await expect(dispatcher.reportProgress(
      "task-progress-conflict",
      "Running tests",
      "trae-progress",
    )).rejects.toMatchObject({ status: 409 });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry a Trae progress response with invalid JSON", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: "ok",
        task: {
          task_id: "task-progress-invalid-json",
          attempt_id: "attempt-progress-invalid-json",
          lease_token: "lease-progress-invalid-json",
          protocol_version: "2026-05-v1",
          trace_id: "trace-progress-invalid-json",
          idempotency_key: "worker-v1:task-progress-invalid-json:attempt-progress-invalid-json",
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response("not-json", { status: 200 }));
    const dispatcher = createDispatcherClient("http://127.0.0.1:8787", {
      fetchImpl: fetchImpl as never,
    });

    await dispatcher.fetchTask("trae-progress", "/tmp/repo");
    await expect(dispatcher.reportProgress(
      "task-progress-invalid-json",
      "Running tests",
      "trae-progress",
    )).rejects.toMatchObject({ name: "DispatcherResponseError", retryable: false });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("cancels Trae progress while waiting to retry", async () => {
    process.env.WORKER_PROGRESS_RETRY_DELAY_MS = "60000";
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: "ok",
        task: {
          task_id: "task-progress-abort",
          attempt_id: "attempt-progress-abort",
          lease_token: "lease-progress-abort",
          protocol_version: "2026-05-v1",
          trace_id: "trace-progress-abort",
          idempotency_key: "worker-v1:task-progress-abort:attempt-progress-abort",
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response('{"error":"temporarily unavailable"}', { status: 503 }));
    const dispatcher = createDispatcherClient("http://127.0.0.1:8787", {
      fetchImpl: fetchImpl as never,
    });
    const controller = new AbortController();

    await dispatcher.fetchTask("trae-progress", "/tmp/repo");
    const pending = dispatcher.reportProgress(
      "task-progress-abort",
      "Running tests",
      "trae-progress",
      { signal: controller.signal },
    );
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries Trae heartbeat with one stable payload", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('{"error":"temporarily unavailable"}', { status: 503 }))
      .mockResolvedValueOnce(new Response('{"status":"ok"}', { status: 200 }));
    const dispatcher = createDispatcherClient("http://127.0.0.1:8787", {
      fetchImpl: fetchImpl as never,
    });

    const pending = dispatcher.heartbeat("trae-heartbeat");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(pending).resolves.toEqual({ status: "ok" });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const firstBody = (fetchImpl.mock.calls[0] as unknown as [string, { body: string }])[1].body;
    const secondBody = (fetchImpl.mock.calls[1] as unknown as [string, { body: string }])[1].body;
    expect(secondBody).toBe(firstBody);
    expect(JSON.parse(firstBody)).toEqual({ worker_id: "trae-heartbeat" });
  });

  it("stops Trae heartbeat after exactly four transient attempts", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => new Response(
      '{"error":"temporarily unavailable"}',
      { status: 503 },
    ));
    const dispatcher = createDispatcherClient("http://127.0.0.1:8787", {
      fetchImpl: fetchImpl as never,
    });

    const pending = dispatcher.heartbeat("trae-heartbeat");
    const rejection = expect(pending).rejects.toMatchObject({ status: 503 });
    await vi.advanceTimersByTimeAsync(3_000);
    await rejection;

    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it.each([401, 409])("does not retry Trae heartbeat HTTP %s", async (status) => {
    const fetchImpl = vi.fn(async () => new Response("null", { status }));
    const dispatcher = createDispatcherClient("http://127.0.0.1:8787", {
      fetchImpl: fetchImpl as never,
    });

    await expect(dispatcher.heartbeat("trae-heartbeat")).rejects.toMatchObject({ status });

    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("does not retry an invalid Trae heartbeat response", async () => {
    const fetchImpl = vi.fn(async () => new Response("not-json", { status: 200 }));
    const dispatcher = createDispatcherClient("http://127.0.0.1:8787", {
      fetchImpl: fetchImpl as never,
    });

    await expect(dispatcher.heartbeat("trae-heartbeat")).rejects.toMatchObject({
      name: "DispatcherResponseError",
      retryable: false,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("cancels Trae heartbeat while waiting to retry", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => new Response(
      '{"error":"temporarily unavailable"}',
      { status: 503 },
    ));
    const dispatcher = createDispatcherClient("http://127.0.0.1:8787", {
      fetchImpl: fetchImpl as never,
    });
    const controller = new AbortController();

    const pending = dispatcher.heartbeat("trae-heartbeat", { signal: controller.signal });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledOnce();
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("rejects progress when fetchTask has not supplied an attempt envelope", async () => {
    const fetchImpl = vi.fn();
    const dispatcher = createDispatcherClient("http://127.0.0.1:8787", {
      fetchImpl: fetchImpl as never,
    });

    await expect(
      dispatcher.reportProgress("task-missing", "Running tests", "trae-progress"),
    ).rejects.toThrow("worker protocol v1 envelope unavailable for task: task-missing");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends submitResult without evidence for backward compatibility", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const dispatcher = createDispatcherClient("http://127.0.0.1:8787", {
      fetchImpl: fetchImpl as never,
    });

    await dispatcher.submitResult({
      taskId: "task-2",
      status: "review_ready",
      summary: "Done",
      testOutput: "PASS",
      risks: [],
      filesChanged: ["src/a.ts"],
      github: {
        branchName: "ai/trae/task-2",
        commitSha: "abc123",
        pushStatus: "success",
        pushError: null,
        prNumber: 42,
        prUrl: "https://github.com/test/repo/pull/42",
      },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body).toMatchObject({
      task_id: "task-2",
      status: "review_ready",
      summary: "Done",
    });
    expect(body.evidence).toBeUndefined();
  });

  it("sends worker events through dispatcher reportEvent", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const dispatcher = createDispatcherClient("http://127.0.0.1:8787", {
      fetchImpl: fetchImpl as never,
    });

    await dispatcher.reportEvent("trae-remote", {
      type: "fetch_task_start",
      taskId: "task-1",
      payload: { repoDir: "/tmp/project" },
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/api/workers/trae-remote/events",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          type: "fetch_task_start",
          taskId: "task-1",
          at: undefined,
          payload: { repoDir: "/tmp/project" },
        }),
      }),
    );
  });
});
