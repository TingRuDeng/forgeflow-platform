import {
  AutomationSessionStatus,
  type AutomationSessionPublic,
  type AutomationSessionRecord,
  type AutomationSessionStatusValue,
} from "./session-store-types.js";

interface PublicShapeOptions {
  includeResponseText?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseSessionStatus(value: unknown): AutomationSessionStatusValue {
  return Object.values(AutomationSessionStatus).includes(value as AutomationSessionStatusValue)
    ? value as AutomationSessionStatusValue
    : AutomationSessionStatus.PREPARED;
}

export function isTerminalStatus(status: AutomationSessionStatusValue): boolean {
  return (
    status === AutomationSessionStatus.COMPLETED ||
    status === AutomationSessionStatus.FAILED ||
    status === AutomationSessionStatus.INTERRUPTED
  );
}

export function parseSessionRecord(
  sessionId: string,
  value: unknown,
): AutomationSessionRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const rawTarget = value.target;
  return {
    sessionId: typeof value.sessionId === "string" && value.sessionId.trim()
      ? value.sessionId
      : sessionId,
    status: parseSessionStatus(value.status),
    startedAt: typeof value.startedAt === "string" ? value.startedAt : "",
    lastActivityAt: typeof value.lastActivityAt === "string" ? value.lastActivityAt : "",
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
    responseDetected: value.responseDetected === true,
    error: typeof value.error === "string" ? value.error : null,
    responseText: typeof value.responseText === "string" ? value.responseText : null,
    requestFingerprint: typeof value.requestFingerprint === "string"
      ? value.requestFingerprint
      : null,
    target: isRecord(rawTarget) ? rawTarget : null,
    completedAt: typeof value.completedAt === "string" ? value.completedAt : null,
  };
}

export function parseSessionMap(value: unknown): Map<string, AutomationSessionRecord> {
  const rawSessions = isRecord(value) ? value : {};
  const nextSessions = new Map<string, AutomationSessionRecord>();

  for (const [id, rawSession] of Object.entries(rawSessions)) {
    const session = parseSessionRecord(id, rawSession);
    if (session) {
      nextSessions.set(id, session);
    }
  }

  return nextSessions;
}

export function getAutomationSessionPublicShape(
  session: AutomationSessionRecord,
  options: PublicShapeOptions = {},
): AutomationSessionPublic {
  const shape: AutomationSessionPublic = {
    sessionId: session.sessionId,
    status: session.status,
    startedAt: session.startedAt,
    lastActivityAt: session.lastActivityAt,
    responseDetected: session.responseDetected,
    error: session.error,
  };

  if (options.includeResponseText !== false) {
    shape.responseText = session.responseText;
  }

  return shape;
}
