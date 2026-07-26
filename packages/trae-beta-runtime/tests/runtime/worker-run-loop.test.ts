import { describe, expect, it, vi } from "vitest";

import { WorkerResultDeliveryError } from "../../src/runtime/submit-result-lifecycle.js";
import { createTraeAutomationWorkerRuntime } from "../../src/runtime/worker.js";

describe("Trae worker run loop", () => {
  it("stops polling after an unacknowledged terminal result", async () => {
    const sleep = vi.fn(async () => undefined);
    const logger = { warn: vi.fn(), log: vi.fn() };
    const intervalHandle = {} as never;
    const clearIntervalImpl = vi.fn();
    const runtime = createTraeAutomationWorkerRuntime({
      dispatcherClient: {
        register: vi.fn(async () => ({})),
        heartbeat: vi.fn(async () => ({})),
      } as never,
      automationClient: {
        ready: vi.fn(async () => ({ ready: true })),
      } as never,
      workerId: "trae-delivery-test",
      repoDir: "/tmp/project",
      logger,
      sleep,
      setIntervalImpl: vi.fn(() => intervalHandle) as never,
      clearIntervalImpl,
    });
    await runtime.register();
    const deliveryError = new WorkerResultDeliveryError(3, new Error("dispatcher unavailable"));
    const runOnce = vi.spyOn(runtime, "runOnce").mockRejectedValue(deliveryError);

    await expect(runtime.runLoop()).rejects.toBe(deliveryError);

    expect(runOnce).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("stopping after terminal result delivery failure"),
    );
    expect(clearIntervalImpl).toHaveBeenCalledWith(intervalHandle);
  });
});
