import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_HEARTBEAT_DELIVERY_MAX_ATTEMPTS,
  retryHeartbeatDelivery,
  snapshotHeartbeatPayload,
} from "../src/runtime/heartbeat-delivery.js";
import {
  DispatcherHttpError,
  DispatcherTransportError,
} from "../src/runtime/dispatcher-request-retry.js";

describe("heartbeat delivery retry", () => {
  it("retries transient failures using the shared default boundary", async () => {
    const error = new DispatcherTransportError("connection reset");
    const send = vi.fn().mockRejectedValue(error);
    const sleep = vi.fn(async () => {});

    await expect(retryHeartbeatDelivery({ send, sleep })).rejects.toBe(error);

    expect(send.mock.calls.map(([attempt]) => attempt)).toEqual([1, 2, 3, 4]);
    expect(send).toHaveBeenCalledTimes(DEFAULT_HEARTBEAT_DELIVERY_MAX_ATTEMPTS);
    expect(sleep).toHaveBeenCalledTimes(DEFAULT_HEARTBEAT_DELIVERY_MAX_ATTEMPTS - 1);
    expect(sleep).toHaveBeenCalledWith(1_000, undefined);
  });

  it("does not retry permanent heartbeat failures", async () => {
    const error = new DispatcherHttpError("worker is not registered", 409);
    const send = vi.fn().mockRejectedValue(error);
    const sleep = vi.fn(async () => {});

    await expect(retryHeartbeatDelivery({ send, sleep })).rejects.toBe(error);

    expect(send).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("uses one immutable payload snapshot across attempts", async () => {
    const payload = { worker_id: "trae-1", metadata: { mode: "high" } };
    const snapshot = snapshotHeartbeatPayload(payload);
    payload.metadata.mode = "idle";
    const seen: unknown[] = [];
    const send = vi.fn(async (attempt: number) => {
      seen.push(snapshot);
      if (attempt === 1) {
        throw new DispatcherHttpError("temporarily unavailable", 503);
      }
      return { ok: true };
    });

    await expect(retryHeartbeatDelivery({
      retryDelayMs: 0,
      send,
    })).resolves.toEqual({ ok: true });

    expect(seen).toEqual([
      { worker_id: "trae-1", metadata: { mode: "high" } },
      { worker_id: "trae-1", metadata: { mode: "high" } },
    ]);
    expect(seen[0]).toBe(seen[1]);
  });

  it("cancels while waiting instead of starting another attempt", async () => {
    const controller = new AbortController();
    const send = vi.fn().mockRejectedValue(
      new DispatcherTransportError("dispatcher unavailable"),
    );
    const pending = retryHeartbeatDelivery({
      retryDelayMs: 60_000,
      send,
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(send).toHaveBeenCalledOnce();
  });
});
