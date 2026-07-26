export const AUTOMATION_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const AUTOMATION_SESSION_RESTART_ERROR = "Gateway restarted during execution";

export const AutomationSessionStatus = {
  PREPARED: "prepared",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  INTERRUPTED: "interrupted",
} as const;

export type AutomationSessionStatusValue =
  typeof AutomationSessionStatus[keyof typeof AutomationSessionStatus];

export interface AutomationSessionPublic {
  sessionId: string;
  status: AutomationSessionStatusValue;
  startedAt: string;
  lastActivityAt: string;
  responseDetected: boolean;
  error: string | null;
  responseText?: string | null;
}

export interface AutomationSessionRecord extends AutomationSessionPublic {
  updatedAt: string;
  responseText: string | null;
  requestFingerprint: string | null;
  target: Record<string, unknown> | null;
  completedAt: string | null;
}

export interface CreateAutomationSessionParams {
  sessionId?: string;
  requestFingerprint?: string | null;
  target?: Record<string, unknown> | null;
}

export interface AutomationSessionStoreOptions {
  now?: () => string;
  randomUUID?: () => string;
  includeResponseText?: boolean;
  restartErrorMessage?: string;
  lockTimeoutMs?: number;
  lockRetryMs?: number;
  lockStaleMs?: number;
}

export interface AutomationSessionStore {
  load: () => Map<string, AutomationSessionRecord>;
  save: () => void;
  create: (params?: CreateAutomationSessionParams) => AutomationSessionPublic;
  get: (sessionId: string) => AutomationSessionPublic | null;
  getInternal: (sessionId: string) => AutomationSessionRecord | null;
  update: (
    sessionId: string,
    updates: Partial<AutomationSessionRecord>,
  ) => AutomationSessionPublic | null;
  markRunning: (sessionId: string) => AutomationSessionPublic | null;
  markCompleted: (
    sessionId: string,
    result: { responseText: string },
  ) => AutomationSessionPublic | null;
  markFailed: (sessionId: string, error: string) => AutomationSessionPublic | null;
  markReleased: (sessionId: string) => AutomationSessionPublic | null;
  touchActivity: (
    sessionId: string,
    details?: { responseDetected?: boolean },
  ) => AutomationSessionPublic | null;
  list: (filter?: { status?: AutomationSessionStatusValue }) => AutomationSessionPublic[];
  prune: (ttlMs?: number) => number;
  release: (sessionId: string) => boolean;
  getStateFilePath: () => string;
}
