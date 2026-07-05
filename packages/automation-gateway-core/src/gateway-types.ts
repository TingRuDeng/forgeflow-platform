export interface DiscoveryHints {
  titleContains?: string[];
  urlContains?: string[];
}

export interface AutomationGatewayRequest {
  method?: string;
  pathname?: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
}

export interface AutomationGatewaySuccess<T> {
  success: true;
  code: "OK";
  data: T;
}

export interface AutomationGatewayFailure {
  success: false;
  code: string;
  message: string;
  details: Record<string, unknown>;
}

export interface AutomationGatewayResponse {
  status: number;
  json: AutomationGatewaySuccess<unknown> | AutomationGatewayFailure;
}

export interface AutomationGatewaySession {
  sessionId: string;
  status: string;
  requestFingerprint?: string | null;
  responseText?: string | null;
  responseDetected?: boolean;
  error?: string | null;
}

export interface AutomationGatewaySessionStore {
  create: (params?: {
    sessionId?: string;
    requestFingerprint?: string | null;
    target?: Record<string, unknown> | null;
  }) => AutomationGatewaySession;
  get: (sessionId: string) => AutomationGatewaySession | null;
  getInternal: (sessionId: string) => AutomationGatewaySession | null;
  markRunning: (sessionId: string) => AutomationGatewaySession | null;
  markCompleted: (sessionId: string, result: { responseText: string }) => AutomationGatewaySession | null;
  markFailed: (sessionId: string, error: string) => AutomationGatewaySession | null;
  release: (sessionId: string) => boolean;
  touchActivity: (
    sessionId: string,
    details?: { responseDetected?: boolean },
  ) => AutomationGatewaySession | null;
}

export interface AutomationGatewayDriver {
  getReadiness: (input: { discovery?: DiscoveryHints | null }) => Promise<Record<string, unknown>>;
  prepareSession: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  sendPrompt: (input: {
    content: string;
    sessionId: string | null;
    expectedTaskId?: string | null;
    prepare: boolean;
    discovery: unknown;
    chatMode?: string | null;
    responseRequiredPrefix: unknown;
    responseTimeoutMs: unknown;
    onProgress?: (details: { responseDetected?: boolean }) => void;
  }) => Promise<Record<string, unknown> & { response?: { text?: string } }>;
}

export interface NormalizedAutomationError {
  code: string;
  message: string;
  details: Record<string, unknown>;
}

export interface HandleAutomationGatewayRequestOptions {
  automationDriver: AutomationGatewayDriver;
  sessionStore?: AutomationGatewaySessionStore | null;
  debugLog?: (event: string, details?: Record<string, unknown>) => void;
  normalizeAutomationError?: (error: unknown, fallbackCode: string) => NormalizedAutomationError;
}
