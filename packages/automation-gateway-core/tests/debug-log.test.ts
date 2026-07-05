import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createAutomationGatewayDebugLogger,
  isAutomationGatewayDebugEnabled,
} from "../src/index.js";

describe("debug-log", () => {
  const originalDebugEnv = process.env.TRAE_AUTOMATION_DEBUG;

  afterEach(() => {
    if (originalDebugEnv === undefined) {
      delete process.env.TRAE_AUTOMATION_DEBUG;
      return;
    }
    process.env.TRAE_AUTOMATION_DEBUG = originalDebugEnv;
  });

  it("prefers explicit debug true and otherwise accepts env opt-in", () => {
    process.env.TRAE_AUTOMATION_DEBUG = "false";
    expect(isAutomationGatewayDebugEnabled(true)).toBe(true);

    process.env.TRAE_AUTOMATION_DEBUG = "1";
    expect(isAutomationGatewayDebugEnabled(undefined)).toBe(true);

    process.env.TRAE_AUTOMATION_DEBUG = "true";
    expect(isAutomationGatewayDebugEnabled(undefined)).toBe(true);

    process.env.TRAE_AUTOMATION_DEBUG = "0";
    expect(isAutomationGatewayDebugEnabled(undefined)).toBe(false);
  });

  it("writes structured debug events only when enabled", () => {
    const logger = { log: vi.fn(), warn: vi.fn() };
    const disabledLog = createAutomationGatewayDebugLogger(false, logger, {
      now: () => "2026-07-05T10:00:00.000Z",
    });

    disabledLog("gateway.start", { port: 8790 });
    expect(logger.log).not.toHaveBeenCalled();

    const enabledLog = createAutomationGatewayDebugLogger(true, logger, {
      now: () => "2026-07-05T10:00:00.000Z",
    });
    enabledLog("gateway.start", { port: 8790 });

    expect(logger.log).toHaveBeenCalledWith(
      "[trae-gateway][debug] {\"at\":\"2026-07-05T10:00:00.000Z\",\"event\":\"gateway.start\",\"port\":8790}",
    );
  });
});
