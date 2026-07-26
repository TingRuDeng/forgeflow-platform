import { describe, expect, it, vi } from "vitest";

import {
  submitResultLifecycle,
  WorkerResultDeliveryError,
  type SubmitResultLifecycleInput,
} from "../../src/runtime/submit-result-lifecycle.js";

type TestRequest = { taskId: string; status: string };

function createHarness(
  overrides: Partial<SubmitResultLifecycleInput<TestRequest>> = {},
) {
  const events: Array<{ type: string; payload: Record<string, unknown>; taskId: string }> = [];
  const submitResult = vi.fn(async () => ({}));
  const promoteToIdle = vi.fn();
  const releaseSession = vi.fn(async () => undefined);
  const sleep = vi.fn(async () => undefined);
  const debugLog = vi.fn();
  const input: SubmitResultLifecycleInput<TestRequest> = {
    taskId: "task-1",
    sessionId: "session-1",
    status: "review_ready",
    startPayload: { status: "review_ready" },
    startDebug: { taskId: "task-1" },
    request: { taskId: "task-1", status: "review_ready" },
    donePayload: { status: "review_ready" },
    emitPhaseEvent: vi.fn(async (type, payload, taskId) => {
      events.push({ type, payload, taskId });
    }),
    debugLog,
    submitResult,
    promoteToIdle,
    releaseSession,
    maxAttempts: 3,
    retryDelayMs: 10,
    sleep,
    ...overrides,
  };
  return {
    input,
    events,
    submitResult,
    promoteToIdle,
    releaseSession,
    sleep,
    debugLog,
  };
}

describe("Trae worker submitResult lifecycle", () => {
  it("acknowledges the terminal result before releasing the session", async () => {
    const harness = createHarness();

    await submitResultLifecycle(harness.input);

    expect(harness.submitResult).toHaveBeenCalledTimes(1);
    expect(harness.events.map((event) => event.type)).toEqual([
      "submit_result_start",
      "submit_result_done",
    ]);
    expect(harness.promoteToIdle).toHaveBeenCalledTimes(1);
    expect(harness.releaseSession).toHaveBeenCalledWith("session-1");
  });

  it("retries a transient delivery failure and cleans up only after acknowledgement", async () => {
    const harness = createHarness();
    harness.submitResult
      .mockRejectedValueOnce(new Error("dispatcher temporarily unavailable"))
      .mockResolvedValueOnce({});

    await submitResultLifecycle(harness.input);

    expect(harness.submitResult).toHaveBeenCalledTimes(2);
    expect(harness.sleep).toHaveBeenCalledWith(10);
    expect(harness.events.map((event) => event.type)).toEqual([
      "submit_result_start",
      "submit_result_retry_failed",
      "submit_result_done",
    ]);
    expect(harness.events[1]?.payload).toMatchObject({
      attempt: 1,
      maxAttempts: 3,
      error: "dispatcher temporarily unavailable",
    });
    expect(harness.promoteToIdle).toHaveBeenCalledTimes(1);
    expect(harness.releaseSession).toHaveBeenCalledTimes(1);
  });

  it("surfaces exhausted delivery attempts without releasing unacknowledged work", async () => {
    const harness = createHarness();
    harness.submitResult.mockRejectedValue(new Error("dispatcher unavailable"));

    await expect(submitResultLifecycle(harness.input)).rejects.toEqual(
      expect.objectContaining<Partial<WorkerResultDeliveryError>>({
        name: "WorkerResultDeliveryError",
        attempts: 3,
      }),
    );

    expect(harness.submitResult).toHaveBeenCalledTimes(3);
    expect(harness.sleep).toHaveBeenCalledTimes(2);
    expect(harness.events.filter((event) => event.type === "submit_result_retry_failed")).toHaveLength(3);
    expect(harness.events.at(-1)).toMatchObject({
      type: "delivery_failed",
      payload: {
        stage: "submit_result",
        failureCode: "delivery_failed",
        attempts: 3,
      },
    });
    expect(harness.events.some((event) => event.type === "submit_result_done")).toBe(false);
    expect(harness.promoteToIdle).not.toHaveBeenCalled();
    expect(harness.releaseSession).not.toHaveBeenCalled();
  });

  it("stops retrying when the worker is aborted during backoff", async () => {
    const controller = new AbortController();
    const harness = createHarness({
      signal: controller.signal,
      emitPhaseEvent: vi.fn(async (type, payload, taskId) => {
        harness.events.push({ type, payload, taskId });
        if (type === "submit_result_retry_failed") {
          controller.abort();
        }
      }),
    });
    harness.submitResult.mockRejectedValue(new Error("dispatcher unavailable"));

    await expect(submitResultLifecycle(harness.input)).rejects.toMatchObject({
      name: "AbortError",
      message: "Trae worker result delivery aborted",
    });

    expect(harness.submitResult).toHaveBeenCalledTimes(1);
    expect(harness.sleep).not.toHaveBeenCalled();
    expect(harness.events.some((event) => event.type === "delivery_failed")).toBe(false);
    expect(harness.events.some((event) => event.type === "submit_result_done")).toBe(false);
    expect(harness.promoteToIdle).not.toHaveBeenCalled();
    expect(harness.releaseSession).not.toHaveBeenCalled();
  });

  it("passes the abort signal into an in-flight submit request", async () => {
    const controller = new AbortController();
    const submitResult = vi.fn(async (_request: TestRequest, options?: { signal?: AbortSignal }) => {
      expect(options?.signal).toBe(controller.signal);
      controller.abort();
      const error = new Error("request aborted");
      error.name = "AbortError";
      throw error;
    });
    const harness = createHarness({
      signal: controller.signal,
      submitResult,
    });

    await expect(submitResultLifecycle(harness.input)).rejects.toMatchObject({
      name: "AbortError",
      message: "Trae worker result delivery aborted",
    });

    expect(submitResult).toHaveBeenCalledTimes(1);
    expect(harness.sleep).not.toHaveBeenCalled();
    expect(harness.promoteToIdle).not.toHaveBeenCalled();
    expect(harness.releaseSession).not.toHaveBeenCalled();
  });

  it("does not turn a post-acknowledgement diagnostic failure into another terminal result", async () => {
    const harness = createHarness({
      emitPhaseEvent: vi.fn(async (type, payload, taskId) => {
        harness.events.push({ type, payload, taskId });
        if (type === "submit_result_done") {
          throw new Error("event channel unavailable");
        }
      }),
    });

    await expect(submitResultLifecycle(harness.input)).resolves.toBeUndefined();

    expect(harness.submitResult).toHaveBeenCalledTimes(1);
    expect(harness.promoteToIdle).toHaveBeenCalledTimes(1);
    expect(harness.releaseSession).toHaveBeenCalledTimes(1);
  });
});
