import http from "node:http";
import { createTraeAutomationDriver, TraeAutomationDriver } from "./trae-dom-driver.js";
import { normalizeAutomationError } from "./trae-automation-errors.js";
import { createSessionStore, SessionStore, SessionPublic, Session, DEFAULT_STATE_DIR } from "./trae-automation-session-store.js";
import { logger } from "./logger.js";
import { ApiError, normalizeApiError, isTimeoutError, parseDiscoveryFromQuery } from "./trae-automation-gateway-helpers.js";

function writeJson(res: http.ServerResponse, statusCode: number, payload: unknown): void {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function writeSuccess(res: http.ServerResponse, statusCode: number, data: unknown): void {
  writeJson(res, statusCode, {
    success: true,
    code: "OK",
    data,
  });
}

function writeError(res: http.ServerResponse, error: unknown): void {
  const normalized = normalizeApiError(error);
  writeJson(res, normalized.statusCode, {
    success: false,
    code: normalized.code,
    message: normalized.message,
    details: normalized.details || {},
  });
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new ApiError("INVALID_JSON", "Request body is not valid JSON", 400));
      }
    });
    req.on("error", (error) => {
      reject(new ApiError("READ_BODY_FAILED", "Failed to read request body", 400, {
        message: error.message,
      }));
    });
  });
}

export interface HandleTraeAutomationHttpRequestInput {
  method: string;
  pathname: string;
  query: Record<string, string>;
  body: unknown;
}

export interface HandleTraeAutomationHttpRequestOptions {
  automationDriver?: TraeAutomationDriver;
  sessionStore?: SessionStore | null;
  automationOptions?: Record<string, unknown>;
  debugLog?: (event: string, details?: Record<string, unknown>) => void;
}

function readOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export async function handleTraeAutomationHttpRequest(input: HandleTraeAutomationHttpRequestInput, options: HandleTraeAutomationHttpRequestOptions = {}): Promise<{ status: number; json: unknown }> {
  const automationDriver = options.automationDriver || createTraeAutomationDriver(options.automationOptions || {});
  const sessionStore = options.sessionStore || null;
  const debugLog = options.debugLog || (() => {});
  const method = String(input.method || "GET").toUpperCase();
  const pathname = input.pathname || "/";
  const query = input.query || {};
  const body = input.body ?? {};
  debugLog("request.received", { method, pathname });

  if (method === "GET" && pathname === "/ready") {
    const readiness = await automationDriver.getReadiness({
      discovery: parseDiscoveryFromQuery(query) || undefined,
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
    try {
      const bodyObj = body as Record<string, unknown>;
      let sessionId = typeof bodyObj.sessionId === "string" && bodyObj.sessionId.trim()
        ? bodyObj.sessionId.trim()
        : null;

      if (sessionStore) {
        const session = sessionStore.create({
          ...(sessionId ? { sessionId } : {}),
          requestFingerprint: bodyObj.content as string || null,
        });
        sessionId = session.sessionId;
      }

      const result = await automationDriver.prepareSession(bodyObj);
      if (sessionStore && sessionId) {
        sessionStore.markRunning(sessionId);
      }

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
      const normalized = normalizeAutomationError(error, "AUTOMATION_PREPARE_FAILED");
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
    const bodyObj = body as Record<string, unknown>;
    const content = String(bodyObj.content || "").trim();
    if (!content) {
      throw new ApiError("INVALID_REQUEST", "content is required", 400);
    }

    const sessionId = readOptionalString(bodyObj.sessionId);
    let session: Session | null = null;
    debugLog("chat.start", {
      sessionId,
      contentLength: content.length,
      contentPreview: content.slice(0, 120),
      chatMode: readOptionalString(bodyObj.chatMode),
      responseRequiredPrefix: readOptionalString(bodyObj.responseRequiredPrefix),
      responseTimeoutMs: typeof bodyObj.responseTimeoutMs === "number" ? bodyObj.responseTimeoutMs : null,
    });

    if (sessionStore && sessionId) {
      session = sessionStore.getInternal(sessionId);
      if (session && session.status === "completed" && session.responseText) {
        return {
          status: 200,
          json: {
            success: true,
            code: "OK",
            data: {
              status: "ok",
              response: { text: session.responseText },
              cached: true,
            },
          },
        };
      }

      if (session && session.status === "running") {
        throw new ApiError("SESSION_CONFLICT", `Session ${sessionId} is already running`, 409);
      }

      if (session && session.requestFingerprint && session.requestFingerprint !== content) {
        throw new ApiError("SESSION_CONFLICT", `Session ${sessionId} request fingerprint mismatch`, 409);
      }
    }

    if (sessionStore && sessionId && session) {
      sessionStore.markRunning(sessionId);
    }

    try {
      const result = await automationDriver.sendPrompt({
        content,
        sessionId,
        expectedTaskId: readOptionalString(bodyObj.expectedTaskId),
        prepare: bodyObj.prepare !== false,
        discovery: bodyObj.discovery as Record<string, unknown> || null,
        chatMode: readOptionalString(bodyObj.chatMode),
        responseRequiredPrefix: bodyObj.responseRequiredPrefix as string || undefined,
        responseTimeoutMs: bodyObj.responseTimeoutMs as number || undefined,
        onProgress: sessionStore && sessionId ? (details) => {
          sessionStore!.touchActivity(sessionId, details);
        } : undefined,
      });

      if (sessionStore && sessionId) {
        sessionStore.markCompleted(sessionId, {
          responseText: (result?.response as { text?: string })?.text || "",
        });
      }
      debugLog("chat.done", {
        sessionId,
        hasResponseText: Boolean((result?.response as { text?: string })?.text),
        responseLength: String((result?.response as { text?: string })?.text || "").length,
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
        sessionStore.markFailed(sessionId, (error as Error)?.message || "Unknown error");
      }

      const normalized = normalizeAutomationError(error, "AUTOMATION_REQUEST_FAILED");
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

export interface StartTraeAutomationGatewayOptions {
  host?: string;
  port?: number | string;
  stateDir?: string | null;
  automationDriver?: TraeAutomationDriver;
  automationOptions?: Record<string, unknown>;
  sessionStore?: SessionStore | null;
}

export interface TraeAutomationGateway {
  host: string;
  port: number;
  baseUrl: string;
  server: http.Server;
  sessionStore: SessionStore | null;
  close: () => Promise<void>;
}

export async function startTraeAutomationGateway(options: StartTraeAutomationGatewayOptions = {}): Promise<TraeAutomationGateway> {
  const host = options.host || "127.0.0.1";
  const port = options.port === undefined ? 8790 : Number(options.port);
  const stateDir = options.stateDir ?? DEFAULT_STATE_DIR;
  const automationDriver = options.automationDriver || createTraeAutomationDriver(options.automationOptions || {});

  const sessionStore = options.sessionStore === null
    ? null
    : options.sessionStore || createSessionStore(stateDir);

  if (sessionStore) {
    sessionStore.load();
    const pruned = sessionStore.prune();
    if (pruned > 0) {
      logger.info({ event: "session_pruned", prunedCount: pruned });
    }
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
      const body = req.method === "POST" ? await readJsonBody(req) : {};
      const result = await handleTraeAutomationHttpRequest({
        method: req.method || "GET",
        pathname: url.pathname,
        query: Object.fromEntries(url.searchParams.entries()),
        body,
      }, { automationDriver, sessionStore });
      writeJson(res, result.status, result.json);
    } catch (error) {
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
