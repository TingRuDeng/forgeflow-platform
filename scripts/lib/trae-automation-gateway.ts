import { createTraeAutomationDriver, TraeAutomationDriver } from "./trae-dom-driver.js";

import {
  normalizeAutomationError,
  ApiError,
  DEFAULT_STATE_DIR,
  createSessionStore,
  SessionStore,
  SessionPublic,
  Session,
  handleTraeAutomationHttpRequest,
  startTraeAutomationGateway,
  type StartTraeAutomationGatewayOptions,
  type TraeAutomationGateway,
} from "@tingrudeng/automation-gateway-core";

export { DEFAULT_STATE_DIR };
export type { SessionStore, SessionPublic, Session };
export { ApiError };
export { handleTraeAutomationHttpRequest, startTraeAutomationGateway };
export type { StartTraeAutomationGatewayOptions, TraeAutomationGateway };
