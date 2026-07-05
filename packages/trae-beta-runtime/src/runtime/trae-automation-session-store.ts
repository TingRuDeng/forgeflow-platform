import os from "node:os";
import path from "node:path";

import {
  AutomationSessionStatus as SessionStatus,
  createPersistentAutomationSessionStore,
  getAutomationSessionPublicShape as getPublicShape,
  type AutomationSessionPublic as SessionPublicShape,
  type AutomationSessionRecord as SessionRecord,
  type AutomationSessionStatusValue,
  type AutomationSessionStore,
  type AutomationSessionStoreOptions as CreateSessionStoreOptions,
  type CreateAutomationSessionParams as CreateSessionParams,
} from "@tingrudeng/automation-gateway-core";

// Use user-stable directory instead of relative path to avoid writing to node_modules.
export const DEFAULT_STATE_DIR = path.join(os.homedir(), ".forgeflow-trae-beta", "sessions");
export { SessionStatus, getPublicShape };
export type SessionStatus = AutomationSessionStatusValue;
export type {
  CreateSessionParams,
  CreateSessionStoreOptions,
  SessionPublicShape,
  SessionRecord,
};
export type MarkCompletedResult = { responseText: string };
export type TouchActivityDetails = { responseDetected?: boolean };
export type SessionListFilter = { status?: AutomationSessionStatusValue };
export type SessionStore = Omit<AutomationSessionStore, "list"> & {
  list: (filter?: SessionListFilter) => SessionPublicShape[];
};

export function createSessionStore(
  stateDir?: string | null,
  options: CreateSessionStoreOptions = {},
): SessionStore {
  return createPersistentAutomationSessionStore(stateDir || DEFAULT_STATE_DIR, options) as SessionStore;
}
