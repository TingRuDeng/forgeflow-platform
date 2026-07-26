import { afterEach, describe, expect, it, vi } from "vitest";

import { startSingleFlightInterval } from "../src/runtime/single-flight-interval.js";

describe("single-flight interval", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not overlap slow interval work", async () => {
    vi.useFakeTimers();
    const gate: { resolve?: () => void } = {};
    let active = 0;
    let maxActive = 0;
    const run = vi.fn(() => new Promise<void>((resolve) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      gate.resolve = () => {
        active -= 1;
        resolve();
      };
    }));
    const stop = startSingleFlightInterval({
      intervalMs: 10,
      run,
    });

    await vi.advanceTimersByTimeAsync(50);
    expect(run).toHaveBeenCalledTimes(1);
    expect(maxActive).toBe(1);

    gate.resolve?.();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(10);
    expect(run).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);

    gate.resolve?.();
    await stop();
  });
});
