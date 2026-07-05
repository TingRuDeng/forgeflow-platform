import { describe, expect, it, vi } from "vitest";

import {
  resolveAutomationGatewayDriver,
  type AutomationGatewayDriver,
} from "../src/index.js";

function createDriverStub(): AutomationGatewayDriver {
  return {
    getReadiness: async () => ({}),
    prepareSession: async () => ({}),
    sendPrompt: async () => ({}),
  };
}

describe("driver-factory", () => {
  it("returns an injected driver without calling the factory", () => {
    const driver = createDriverStub();
    const createDriver = vi.fn(() => createDriverStub());

    expect(resolveAutomationGatewayDriver({ automationDriver: driver, createDriver })).toBe(driver);
    expect(createDriver).not.toHaveBeenCalled();
  });

  it("normalizes gateway debug and preserves other automation options", () => {
    const driver = createDriverStub();
    const createDriver = vi.fn(() => driver);

    const resolved = resolveAutomationGatewayDriver({
      automationOptions: { targetUrl: "http://127.0.0.1:9222", debug: "0" },
      createDriver,
      debugEnabled: true,
    });

    expect(resolved).toBe(driver);
    expect(createDriver).toHaveBeenCalledWith({
      targetUrl: "http://127.0.0.1:9222",
      debug: true,
    });
  });

  it("keeps explicit automation debug opt-in without requiring gateway debug", () => {
    const driver = createDriverStub();
    const createDriver = vi.fn(() => driver);

    resolveAutomationGatewayDriver({
      automationOptions: { debug: "1" },
      createDriver,
      debugEnabled: false,
    });

    expect(createDriver).toHaveBeenCalledWith({ debug: true });
  });
});
