import { createTraeAutomationDriver } from "./trae-dom-driver.js";

import {
  ApiError,
  DEFAULT_STATE_DIR,
  createSessionStore,
  type SessionStore,
  handleTraeAutomationHttpRequest,
  startTraeAutomationGateway,
  type StartTraeAutomationGatewayOptions,
  type StartedTraeAutomationGateway,
} from "@tingrudeng/automation-gateway-core";

export { DEFAULT_STATE_DIR };
export type { SessionStore };
export { ApiError };
export { handleTraeAutomationHttpRequest, startTraeAutomationGateway };
export type { StartTraeAutomationGatewayOptions, StartedTraeAutomationGateway };

export function createAutomationGateway(
  options: {
    host?: string;
    port?: number;
    stateDir?: string | null;
    automationOptions?: Record<string, unknown>;
    sessionStore?: SessionStore | null;
    logger?: Pick<typeof console, "log" | "warn">;
    debug?: boolean;
  } = {}
): ReturnType<typeof startTraeAutomationGateway> {
  return startTraeAutomationGateway({
    ...options,
    automationDriver: createTraeAutomationDriver(options.automationOptions || {}),
  });
}
