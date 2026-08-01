import { describe, expect, it, vi } from "vitest";

import {
  DispatcherHttpError,
  DispatcherResponseError,
  DispatcherTransportError,
  isRetryableDispatcherRequestError,
  readDispatcherHttpErrorMessage,
} from "../src/runtime/dispatcher-request-retry.js";
import {
  retryProgressDelivery,
  snapshotProgressPayload,
} from "../src/runtime/progress-delivery.js";

describe("progress delivery retry", () => {
  it("retries transient failures within the bounded attempt count", async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(new DispatcherTransportError("connection reset"))
      .mockResolvedValueOnce({ status: "progress_recorded" });
    const sleep = vi.fn(async () => {});

    await expect(retryProgressDelivery({
      maxAttempts: 3,
      retryDelayMs: 1_000,
      send,
      sleep,
    })).resolves.toEqual({ status: "progress_recorded" });

    expect(send.mock.calls.map(([attempt]) => attempt)).toEqual([1, 2]);
    expect(sleep).toHaveBeenCalledOnce();
  });

  it("does not retry ordinary client or protocol failures", async () => {
    const error = new DispatcherHttpError("lease conflict", 409);
    const send = vi.fn().mockRejectedValue(error);
    const sleep = vi.fn(async () => {});

    await expect(retryProgressDelivery({
      maxAttempts: 3,
      retryDelayMs: 1_000,
      send,
      sleep,
    })).rejects.toBe(error);

    expect(send).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it.each([408, 425, 429, 500, 503])("classifies HTTP %s as retryable", (status) => {
    expect(isRetryableDispatcherRequestError(
      new DispatcherHttpError(`HTTP ${status}`, status),
    )).toBe(true);
  });

  it.each([400, 401, 403, 409, 422])("classifies HTTP %s as permanent", (status) => {
    expect(isRetryableDispatcherRequestError(
      new DispatcherHttpError(`HTTP ${status}`, status),
    )).toBe(false);
  });

  it("only retries explicitly marked transport errors without an HTTP status", () => {
    expect(isRetryableDispatcherRequestError(
      new DispatcherTransportError("connection reset"),
    )).toBe(true);
    expect(isRetryableDispatcherRequestError(
      new DispatcherResponseError("invalid JSON"),
    )).toBe(false);
    expect(isRetryableDispatcherRequestError(new Error("programming failure"))).toBe(false);
  });

  it("stops progress delivery after exactly three attempts", async () => {
    const error = new DispatcherHttpError("temporarily unavailable", 503);
    const send = vi.fn().mockRejectedValue(error);
    const sleep = vi.fn(async () => {});

    await expect(retryProgressDelivery({
      maxAttempts: 3,
      retryDelayMs: 1_000,
      send,
      sleep,
    })).rejects.toBe(error);

    expect(send.mock.calls.map(([attempt]) => attempt)).toEqual([1, 2, 3]);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("aborts while waiting instead of sending another attempt", async () => {
    const controller = new AbortController();
    const send = vi.fn().mockRejectedValue(
      new DispatcherTransportError("dispatcher unavailable"),
    );
    const pending = retryProgressDelivery({
      maxAttempts: 3,
      retryDelayMs: 60_000,
      send,
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(send).toHaveBeenCalledOnce();
  });

  it("rejects a result when the signal aborts before send resolves", async () => {
    const controller = new AbortController();
    const send = vi.fn(async () => {
      controller.abort();
      return { status: "progress_recorded" };
    });

    await expect(retryProgressDelivery({
      maxAttempts: 3,
      retryDelayMs: 1_000,
      send,
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });

    expect(send).toHaveBeenCalledOnce();
  });

  it("rejects invalid retry policy inputs before sending", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true });

    await expect(retryProgressDelivery({
      maxAttempts: 0,
      retryDelayMs: 1_000,
      send,
    })).rejects.toThrow("maxAttempts must be a positive integer");
    await expect(retryProgressDelivery({
      maxAttempts: 1,
      retryDelayMs: -1,
      send,
    })).rejects.toThrow("retryDelayMs must be a non-negative integer");

    expect(send).not.toHaveBeenCalled();
  });

  it("handles null error bodies without losing the fallback message", () => {
    expect(readDispatcherHttpErrorMessage(null, "null", "HTTP 409")).toBe("HTTP 409");
    expect(readDispatcherHttpErrorMessage(null, "", "HTTP 409")).toBe("HTTP 409");
  });

  it("snapshots nested progress payloads before retry", () => {
    const payload = { progressId: "progress-1", details: { message: "running" } };
    const snapshot = snapshotProgressPayload(payload);
    payload.details.message = "mutated";

    expect(snapshot).toEqual({
      progressId: "progress-1",
      details: { message: "running" },
    });
  });
});
