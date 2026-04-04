import http, { type IncomingMessage, type ServerResponse } from "node:http";

import { normalizeAutomationError } from "./trae-automation-errors.js";
import { DEFAULT_STATE_DIR, createSessionStore, type SessionStore } from "./trae-automation-session-store.js";

export interface DiscoveryHints {
  titleContains?: string[];
  urlContains?: string[];
}

export interface HttpRequestInput {
  method?: string;
  pathname?: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
}

export interface ApiSuccessResponse<T> {
  success: true;
  code: "OK";
  data: T;
}

export interface ApiErrorResponse {
  success: false;
  code: string;
  message: string;
  details: Record<string, unknown>;
}

export interface AutomationSendPromptResult extends Record<string, unknown> {
  response?: {
    text?: string;
  };
}

export interface AutomationDriver {
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
  }) => Promise<AutomationSendPromptResult>;
}

export interface HandleTraeAutomationHttpRequestOptions {
  automationDriver?: AutomationDriver;
  automationOptions?: Record<string, unknown>;
  sessionStore?: SessionStore | null;
  debugLog?: (event: string, details?: Record<string, unknown>) => void;
}

export interface StartTraeAutomationGatewayOptions {
  host?: string;
  port?: number;
  stateDir?: string | null;
  automationDriver?: AutomationDriver;
  automationOptions?: Record<string, unknown>;
  sessionStore?: SessionStore | null;
  logger?: Pick<typeof console, "log" | "warn">;
  debug?: boolean;
}

export interface StartedTraeAutomationGateway {
  host: string;
  port: number;
  baseUrl: string;
  server: http.Server;
  sessionStore: SessionStore | null;
  close: () => Promise<void>;
}

export class ApiError extends Error {
  code: string;
  statusCode: number;
  details: Record<string, unknown>;

  constructor(code: string, message: string, statusCode: number, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function writeJson(
  res: ServerResponse,
  statusCode: number,
  payload: ApiSuccessResponse<unknown> | ApiErrorResponse,
) {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function writeError(res: ServerResponse, error: unknown) {
  const normalized = error instanceof ApiError
    ? error
    : new ApiError(
      isRecord(error) && typeof error.code === "string" ? error.code : "INTERNAL_ERROR",
      error instanceof Error ? error.message : "Internal server error",
      500,
      isRecord(error) && isRecord(error.details) ? error.details : {},
    );
  writeJson(res, normalized.statusCode, {
    success: false,
    code: normalized.code,
    message: normalized.message,
    details: normalized.details || {},
  });
}

function isDebugEnabled(value: unknown): boolean {
  if (value === true) {
    return true;
  }
  const envValue = String(process.env.TRAE_AUTOMATION_DEBUG || "").trim().toLowerCase();
  return envValue === "1" || envValue === "true";
}

function createDebugLogger(
  enabled: boolean,
  logger: Pick<typeof console, "log" | "warn">,
) {
  return (event: string, details: Record<string, unknown> = {}) => {
    if (!enabled) {
      return;
    }
    const payload = {
      at: new Date().toISOString(),
      event,
      ...details,
    };
    try {
      logger.log?.(`[trae-gateway][debug] ${JSON.stringify(payload)}`);
    } catch {
      logger.log?.(`[trae-gateway][debug] ${event}`);
    }
  };
}

function parseDiscoveryFromQuery(query: Record<string, string | undefined> = {}): DiscoveryHints | null {
  const titleContains = String(query.title_contains || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const urlContains = String(query.url_contains || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const discovery: DiscoveryHints = {};
  if (titleContains.length > 0) {
    discovery.titleContains = titleContains;
  }
  if (urlContains.length > 0) {
    discovery.urlContains = urlContains;
  }
  return Object.keys(discovery).length > 0 ? discovery : null;
}

function toAutomationErrorPayload(
  error: unknown,
  fallbackCode: string,
): { code: string; message: string; details: Record<string, unknown> } {
  const normalized = normalizeAutomationError(error, fallbackCode) as Error & {
    code?: string;
    details?: Record<string, unknown>;
  };

  return {
    code: normalized.code || fallbackCode,
    message: normalized.message || "Trae automation failed",
    details: isRecord(normalized.details) ? normalized.details : {},
  };
}

function isTimeoutError(error: unknown): boolean {
  if (!error) {
    return false;
  }

  const errorRecord = error as Record<string, unknown>;
  if (errorRecord.code === "AUTOMATION_RESPONSE_TIMEOUT") {
    return true;
  }

  const message = error instanceof Error ? error.message : String(errorRecord.message || "");
  return /request timeout/i.test(message)
    || /timed out waiting for trae to finish responding/i.test(message);
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer | string) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(body) as unknown;
        resolve(isRecord(parsed) ? parsed : {});
      } catch {
        reject(new ApiError("INVALID_JSON", "Request body is not valid JSON", 400));
      }
    });
    req.on("error", (error: Error) => {
      reject(new ApiError("READ_BODY_FAILED", "Failed to read request body", 400, {
        message: error.message,
      }));
    });
  });
}

export async function handleTraeAutomationHttpRequest(
  input: HttpRequestInput,
  options: HandleTraeAutomationHttpRequestOptions = {},
): Promise<{ status: number; json: ApiSuccessResponse<unknown> | ApiErrorResponse }> {
  const automationDriver = (options.automationDriver
    ) as AutomationDriver;
  const sessionStore = options.sessionStore || null;
  const debugLog = options.debugLog || (() => {});
  const method = String(input.method || "GET").toUpperCase();
  const pathname = input.pathname || "/";
  const query = input.query || {};
  const body = isRecord(input.body) ? input.body : {};
  debugLog("request.received", { method, pathname });

  if (method === "GET" && pathname === "/ready") {
    debugLog("ready.start", { discovery: parseDiscoveryFromQuery(query) });
    const readiness = await automationDriver.getReadiness({
      discovery: parseDiscoveryFromQuery(query),
    });
    debugLog("ready.done", {
      ready: Boolean((readiness as { ready?: boolean }).ready),
    });
    return {
      status: 200,
      json: {
        success: true,
        code: "OK",
        data: readiness,
      },
    };
  }

  if (method === "GET" && pathname.startsWith("/v1/sessions/")) {
    const sessionId = pathname.slice("/v1/sessions/".length);
    if (!sessionId) {
      throw new ApiError("INVALID_REQUEST", "sessionId is required", 400);
    }
    if (!sessionStore) {
      throw new ApiError("SESSION_STORE_NOT_CONFIGURED", "Session store is not configured", 500);
    }

    const session = sessionStore.get(sessionId);
    if (!session) {
      throw new ApiError("SESSION_NOT_FOUND", `Session ${sessionId} not found`, 404);
    }

    debugLog("session.get.done", {
      sessionId,
      status: (session as { status?: string }).status || null,
      responseDetected: Boolean((session as { responseDetected?: boolean }).responseDetected),
      hasResponseText: Boolean((session as { responseText?: string | null }).responseText),
    });
    return {
      status: 200,
      json: {
        success: true,
        code: "OK",
        data: session,
      },
    };
  }

  if (method === "POST" && pathname.startsWith("/v1/sessions/") && pathname.endsWith("/release")) {
    const sessionId = pathname.slice("/v1/sessions/".length, -"/release".length);
    if (!sessionId) {
      throw new ApiError("INVALID_REQUEST", "sessionId is required", 400);
    }
    if (!sessionStore) {
      throw new ApiError("SESSION_STORE_NOT_CONFIGURED", "Session store is not configured", 500);
    }

    const released = sessionStore.release(sessionId);
    debugLog("session.release", { sessionId, released });
    return {
      status: 200,
      json: {
        success: true,
        code: "OK",
        data: {
          sessionId,
          released,
        },
      },
    };
  }

  if (method === "POST" && pathname === "/v1/sessions/prepare") {
    debugLog("session.prepare.start", {
      requestedSessionId: readOptionalString(body.sessionId),
      chatMode: readOptionalString(body.chatMode),
    });
    try {
      let sessionId = readOptionalString(body.sessionId);

      if (sessionStore) {
        const session = sessionStore.create({
          ...(sessionId ? { sessionId } : {}),
          requestFingerprint: readOptionalString(body.content),
        });
        sessionId = session.sessionId;
      }

      const result = await automationDriver.prepareSession(body);

      if (sessionStore && sessionId) {
        sessionStore.markRunning(sessionId);
      }
      debugLog("session.prepare.done", { sessionId });

      return {
        status: 200,
        json: {
          success: true,
          code: "OK",
          data: {
            ...result,
            ...(sessionId ? { sessionId } : {}),
          },
        },
      };
    } catch (error) {
      debugLog("session.prepare.error", {
        message: error instanceof Error ? error.message : String(error),
      });
      const normalized = toAutomationErrorPayload(error, "AUTOMATION_PREPARE_FAILED");
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
  }

  if (method === "POST" && pathname === "/v1/chat") {
    const content = String(body.content || "").trim();
    if (!content) {
      throw new ApiError("INVALID_REQUEST", "content is required", 400);
    }

    const sessionId = readOptionalString(body.sessionId);
    debugLog("chat.start", {
      sessionId,
      contentLength: content.length,
      contentPreview: content.slice(0, 120),
      chatMode: typeof body.chatMode === "string" ? body.chatMode : null,
      responseRequiredPrefix: readOptionalString(body.responseRequiredPrefix),
      responseTimeoutMs: typeof body.responseTimeoutMs === "number" ? body.responseTimeoutMs : null,
    });
    if (sessionStore && sessionId) {
      sessionStore.touchActivity(sessionId);
    }

    try {
      const result = await automationDriver.sendPrompt({
        content,
        sessionId,
        expectedTaskId: readOptionalString(body.expectedTaskId),
        prepare: body.prepare !== false,
        discovery: body.discovery || null,
        chatMode: typeof body.chatMode === "string" ? body.chatMode : null,
        responseRequiredPrefix: body.responseRequiredPrefix || null,
        responseTimeoutMs: body.responseTimeoutMs || null,
      });

      if (sessionStore && sessionId) {
        sessionStore.markCompleted(sessionId, {
          responseText: result.response?.text || "",
        });
      }
      debugLog("chat.done", {
        sessionId,
        hasResponseText: Boolean(result.response?.text),
        responseLength: String(result.response?.text || "").length,
      });

      return {
        status: 200,
        json: {
          success: true,
          code: "OK",
          data: result,
        },
      };
    } catch (error) {
      debugLog("chat.error", {
        sessionId,
        message: error instanceof Error ? error.message : String(error),
        timeout: isTimeoutError(error),
      });
      if (sessionStore && sessionId && !isTimeoutError(error)) {
        sessionStore.markFailed(
          sessionId,
          error instanceof Error ? error.message : "Unknown error",
        );
      }

      const normalized = toAutomationErrorPayload(error, "AUTOMATION_REQUEST_FAILED");
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
  }

  throw new ApiError("NOT_FOUND", "Not found", 404);
}

export function startTraeAutomationGateway(
  options: StartTraeAutomationGatewayOptions = {},
): Promise<StartedTraeAutomationGateway> {
  const host = options.host || "127.0.0.1";
  const port = options.port === undefined ? 8790 : Number(options.port);
  const stateDir = options.stateDir ?? DEFAULT_STATE_DIR;
  const logger = options.logger || console;
  const debugEnabled = isDebugEnabled(options.debug);
  const debugLog = createDebugLogger(debugEnabled, logger);
  const automationDriver = options.automationDriver;
  const sessionStore = options.sessionStore === null
    ? null
    : options.sessionStore || createSessionStore(stateDir);

  debugLog("gateway.start", {
    host,
    port,
    stateDir,
    sessionStoreEnabled: Boolean(sessionStore),
  });

  if (sessionStore) {
    sessionStore.load();
    const pruned = sessionStore.prune();
    if (pruned > 0) {
      logger.log?.(`[trae-gateway] pruned ${pruned} expired sessions`);
      debugLog("session.pruned", { pruned });
    }
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
      const body = req.method === "POST" ? await readJsonBody(req) : {};
      const result = await handleTraeAutomationHttpRequest(
        {
          method: req.method,
          pathname: url.pathname,
          query: Object.fromEntries(url.searchParams.entries()),
          body,
        },
        { automationDriver, sessionStore, debugLog },
      );
      writeJson(res, result.status, result.json);
    } catch (error) {
      debugLog("request.error", {
        method: req.method || "UNKNOWN",
        url: req.url || "/",
        message: error instanceof Error ? error.message : String(error),
      });
      writeError(res, error);
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      resolve({
        host,
        port,
        baseUrl: `http://${host}:${port}`,
        server,
        sessionStore,
        close: () => new Promise((resolveClose, rejectClose) => {
          server.close((error) => {
            if (error) {
              rejectClose(error);
              return;
            }
            resolveClose();
          });
        }),
      });
    });
  });
}
