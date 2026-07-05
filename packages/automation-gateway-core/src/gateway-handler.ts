import { ApiError } from "./gateway-errors.js";
import { isRecord, ok, readOptionalString, splitQueryList } from "./gateway-utils.js";
import type {
  AutomationGatewayRequest,
  AutomationGatewayResponse,
  AutomationGatewaySession,
  AutomationGatewaySessionStore,
  DiscoveryHints,
  HandleAutomationGatewayRequestOptions,
  NormalizedAutomationError,
} from "./gateway-types.js";

export function parseDiscoveryFromQuery(query: Record<string, string | undefined> = {}): DiscoveryHints | null {
  const titleContains = splitQueryList(query.title_contains);
  const urlContains = splitQueryList(query.url_contains);
  const discovery: DiscoveryHints = {};
  if (titleContains.length > 0) {
    discovery.titleContains = titleContains;
  }
  if (urlContains.length > 0) {
    discovery.urlContains = urlContains;
  }
  return Object.keys(discovery).length > 0 ? discovery : null;
}

export function isTimeoutError(error: unknown): boolean {
  if (!error) {
    return false;
  }
  const record = isRecord(error) ? error : {};
  if (record.code === "AUTOMATION_RESPONSE_TIMEOUT") {
    return true;
  }
  const message = error instanceof Error ? error.message : String(record.message || "");
  return /request timeout/i.test(message)
    || /timed out waiting for trae to finish responding/i.test(message);
}

export async function handleAutomationGatewayRequest(
  input: AutomationGatewayRequest,
  options: HandleAutomationGatewayRequestOptions,
): Promise<AutomationGatewayResponse> {
  const method = String(input.method || "GET").toUpperCase();
  const pathname = input.pathname || "/";
  const query = input.query || {};
  const body = isRecord(input.body) ? input.body : {};
  const debugLog = options.debugLog || (() => {});
  debugLog("request.received", { method, pathname });

  if (method === "GET" && pathname === "/ready") {
    return handleReady(query, options, debugLog);
  }
  if (method === "GET" && pathname.startsWith("/v1/sessions/")) {
    return handleGetSession(pathname, options);
  }
  if (method === "POST" && pathname.startsWith("/v1/sessions/") && pathname.endsWith("/release")) {
    return handleReleaseSession(pathname, options, debugLog);
  }
  if (method === "POST" && pathname === "/v1/sessions/prepare") {
    return handlePrepareSession(body, options, debugLog);
  }
  if (method === "POST" && pathname === "/v1/chat") {
    return handleChat(body, options, debugLog);
  }

  throw new ApiError("NOT_FOUND", "Not found", 404);
}

async function handleReady(
  query: Record<string, string | undefined>,
  options: HandleAutomationGatewayRequestOptions,
  debugLog: (event: string, details?: Record<string, unknown>) => void,
): Promise<AutomationGatewayResponse> {
  const discovery = parseDiscoveryFromQuery(query);
  debugLog("ready.start", { discovery });
  const readiness = await options.automationDriver.getReadiness({ discovery });
  debugLog("ready.done", { ready: Boolean(readiness.ready) });
  return ok(readiness);
}

function requireSessionStore(options: HandleAutomationGatewayRequestOptions): AutomationGatewaySessionStore {
  if (!options.sessionStore) {
    throw new ApiError("SESSION_STORE_NOT_CONFIGURED", "Session store is not configured", 500);
  }
  return options.sessionStore;
}

function handleGetSession(pathname: string, options: HandleAutomationGatewayRequestOptions): AutomationGatewayResponse {
  const sessionStore = requireSessionStore(options);
  const sessionId = pathname.slice("/v1/sessions/".length);
  if (!sessionId) {
    throw new ApiError("INVALID_REQUEST", "sessionId is required", 400);
  }
  const session = sessionStore.get(sessionId);
  if (!session) {
    throw new ApiError("SESSION_NOT_FOUND", `Session ${sessionId} not found`, 404);
  }
  return ok(session);
}

function handleReleaseSession(
  pathname: string,
  options: HandleAutomationGatewayRequestOptions,
  debugLog: (event: string, details?: Record<string, unknown>) => void,
): AutomationGatewayResponse {
  const sessionStore = requireSessionStore(options);
  const sessionId = pathname.slice("/v1/sessions/".length, -"/release".length);
  if (!sessionId) {
    throw new ApiError("INVALID_REQUEST", "sessionId is required", 400);
  }
  const released = sessionStore.release(sessionId);
  debugLog("session.release", { sessionId, released });
  return ok({ sessionId, released });
}

async function handlePrepareSession(
  body: Record<string, unknown>,
  options: HandleAutomationGatewayRequestOptions,
  debugLog: (event: string, details?: Record<string, unknown>) => void,
): Promise<AutomationGatewayResponse> {
  debugLog("session.prepare.start", {
    requestedSessionId: readOptionalString(body.sessionId),
    chatMode: readOptionalString(body.chatMode),
  });
  try {
    let sessionId = readOptionalString(body.sessionId);
    if (options.sessionStore) {
      const session = options.sessionStore.create({
        ...(sessionId ? { sessionId } : {}),
        requestFingerprint: readOptionalString(body.content),
      });
      sessionId = session.sessionId;
    }
    const result = await options.automationDriver.prepareSession(body);
    if (options.sessionStore && sessionId) {
      options.sessionStore.markRunning(sessionId);
    }
    debugLog("session.prepare.done", { sessionId });
    return ok({ ...result, ...(sessionId ? { sessionId } : {}) });
  } catch (error) {
    return automationFailure(error, "AUTOMATION_PREPARE_FAILED", options, debugLog, "session.prepare.error");
  }
}

async function handleChat(
  body: Record<string, unknown>,
  options: HandleAutomationGatewayRequestOptions,
  debugLog: (event: string, details?: Record<string, unknown>) => void,
): Promise<AutomationGatewayResponse> {
  const content = String(body.content || "").trim();
  if (!content) {
    throw new ApiError("INVALID_REQUEST", "content is required", 400);
  }
  const sessionId = readOptionalString(body.sessionId);
  debugLog("chat.start", buildChatStartLog(sessionId, content, body));
  const session = validateChatSession(options.sessionStore || null, sessionId, content);
  if (session?.status === "completed" && session.responseText) {
    return ok({ status: "ok", response: { text: session.responseText }, cached: true });
  }
  if (options.sessionStore && sessionId && session) {
    options.sessionStore.markRunning(sessionId);
  }
  return sendChatPrompt(content, sessionId, body, options, debugLog);
}

function validateChatSession(
  sessionStore: AutomationGatewaySessionStore | null,
  sessionId: string | null,
  content: string,
): AutomationGatewaySession | null {
  if (!sessionStore || !sessionId) {
    return null;
  }
  const session = sessionStore.getInternal(sessionId);
  if (session?.status === "running") {
    throw new ApiError("SESSION_CONFLICT", `Session ${sessionId} is already running`, 409);
  }
  if (session?.requestFingerprint && session.requestFingerprint !== content) {
    throw new ApiError("SESSION_CONFLICT", `Session ${sessionId} request fingerprint mismatch`, 409);
  }
  return session;
}

function buildChatStartLog(sessionId: string | null, content: string, body: Record<string, unknown>) {
  return {
    sessionId,
    contentLength: content.length,
    contentPreview: content.slice(0, 120),
    chatMode: readOptionalString(body.chatMode),
    responseRequiredPrefix: readOptionalString(body.responseRequiredPrefix),
    responseTimeoutMs: typeof body.responseTimeoutMs === "number" ? body.responseTimeoutMs : null,
  };
}

async function sendChatPrompt(
  content: string,
  sessionId: string | null,
  body: Record<string, unknown>,
  options: HandleAutomationGatewayRequestOptions,
  debugLog: (event: string, details?: Record<string, unknown>) => void,
): Promise<AutomationGatewayResponse> {
  try {
    const result = await options.automationDriver.sendPrompt({
      content,
      sessionId,
      expectedTaskId: readOptionalString(body.expectedTaskId),
      prepare: body.prepare !== false,
      discovery: body.discovery || null,
      chatMode: readOptionalString(body.chatMode),
      responseRequiredPrefix: body.responseRequiredPrefix || null,
      responseTimeoutMs: body.responseTimeoutMs || null,
      onProgress: options.sessionStore && sessionId
        ? (details) => options.sessionStore?.touchActivity(sessionId, details)
        : undefined,
    });
    markChatCompleted(options.sessionStore || null, sessionId, result);
    debugLog("chat.done", buildChatDoneLog(sessionId, result));
    return ok(result);
  } catch (error) {
    return handleChatError(error, sessionId, options, debugLog);
  }
}

function markChatCompleted(
  sessionStore: AutomationGatewaySessionStore | null,
  sessionId: string | null,
  result: { response?: { text?: string } },
): void {
  if (sessionStore && sessionId) {
    sessionStore.markCompleted(sessionId, { responseText: result.response?.text || "" });
  }
}

function buildChatDoneLog(sessionId: string | null, result: { response?: { text?: string } }) {
  const responseText = String(result.response?.text || "");
  return {
    sessionId,
    hasResponseText: Boolean(responseText),
    responseLength: responseText.length,
  };
}

function handleChatError(
  error: unknown,
  sessionId: string | null,
  options: HandleAutomationGatewayRequestOptions,
  debugLog: (event: string, details?: Record<string, unknown>) => void,
): AutomationGatewayResponse {
  debugLog("chat.error", {
    sessionId,
    message: error instanceof Error ? error.message : String(error),
    timeout: isTimeoutError(error),
  });
  if (options.sessionStore && sessionId && !isTimeoutError(error)) {
    options.sessionStore.markFailed(sessionId, error instanceof Error ? error.message : "Unknown error");
  }
  return automationFailure(error, "AUTOMATION_REQUEST_FAILED", options);
}

function automationFailure(
  error: unknown,
  fallbackCode: string,
  options: HandleAutomationGatewayRequestOptions,
  debugLog?: (event: string, details?: Record<string, unknown>) => void,
  debugEvent?: string,
): AutomationGatewayResponse {
  debugLog?.(debugEvent || "automation.error", {
    message: error instanceof Error ? error.message : String(error),
  });
  const normalized = normalizeAutomationFailure(error, fallbackCode, options);
  return {
    status: 502,
    json: {
      success: false,
      code: normalized.code,
      message: normalized.message,
      details: normalized.details,
    },
  };
}

function normalizeAutomationFailure(
  error: unknown,
  fallbackCode: string,
  options: HandleAutomationGatewayRequestOptions,
): NormalizedAutomationError {
  if (options.normalizeAutomationError) {
    return options.normalizeAutomationError(error, fallbackCode);
  }
  const record = isRecord(error) ? error : {};
  return {
    code: typeof record.code === "string" ? record.code : fallbackCode,
    message: error instanceof Error ? error.message : "Trae automation failed",
    details: isRecord(record.details) ? record.details : {},
  };
}
