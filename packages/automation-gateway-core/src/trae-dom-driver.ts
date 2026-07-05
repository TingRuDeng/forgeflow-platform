// @ts-nocheck
import {
  createDriverRuntime,
  getDriverReadiness,
  prepareDriverSession,
  sendDriverPrompt,
} from "./trae-dom-driver-runtime.js";

export * from "./trae-dom-driver-config.js";
export * from "./trae-dom-expressions.js";
export * from "./trae-dom-response.js";

export function createTraeAutomationDriver(options = {}) {
  const runtime = createDriverRuntime(options);
  return {
    getReadiness: (payload = {}) => getDriverReadiness(runtime, payload),
    prepareSession: (payload = {}) => prepareDriverSession(runtime, payload),
    sendPrompt: (payload = {}) => sendDriverPrompt(runtime, payload),
  };
}
