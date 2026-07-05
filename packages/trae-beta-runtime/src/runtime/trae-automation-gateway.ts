import http, { type IncomingMessage, type ServerResponse } from "node:http";

import {
  ApiError,
  handleAutomationGatewayRequest,
  normalizeApiError,
  type AutomationGatewayDriver,
} from "@tingrudeng/automation-gateway-core";

import { normalizeAutomationError } from "./trae-automation-errors.js";
import { DEFAULT_STATE_DIR, createSessionStore, type SessionStore } from "./trae-automation-session-store.js";
import { createTraeAutomationDriver } from "./trae-dom-driver.js";

interface HttpRequestInput {
  method?: string;
  pathname?: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
}

interface ApiSuccessResponse<T> {
  success: true;
  code: "OK";
  data: T;
}

interface ApiErrorResponse {
  success: false;
  code: string;
  message: string;
  details: Record<string, unknown>;
}

interface HandleTraeAutomationHttpRequestOptions {
  automationDriver?: AutomationGatewayDriver;
  automationOptions?: Record<string, unknown>;
  sessionStore?: SessionStore | null;
  debugLog?: (event: string, details?: Record<string, unknown>) => void;
}

interface StartTraeAutomationGatewayOptions {
  host?: string;
  port?: number;
  stateDir?: string | null;
  automationDriver?: AutomationGatewayDriver;
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

function writeJson(
  res: ServerResponse,
  statusCode: number,
  payload: ApiSuccessResponse<unknown> | ApiErrorResponse,
) {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function writeError(res: ServerResponse, error: unknown) {
  const normalized = normalizeApiError(error);
  writeJson(res, normalized.statusCode, {
    success: false,
    code: normalized.code,
    message: normalized.message,
    details: normalized.details || {},
  });
}

function isDebugEnabled(value: unknown) {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    || createTraeAutomationDriver(options.automationOptions || {})) as AutomationGatewayDriver;
  return handleAutomationGatewayRequest(input, {
    automationDriver,
    sessionStore: options.sessionStore || null,
    debugLog: options.debugLog,
    normalizeAutomationError: (error, fallbackCode) => {
      const normalized = normalizeAutomationError(error, fallbackCode) as Error & {
        code?: string;
        details?: Record<string, unknown>;
      };
      return {
        code: normalized.code || fallbackCode,
        message: normalized.message || "Trae automation failed",
        details: normalized.details || {},
      };
    },
  });
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
  const automationDriver = (options.automationDriver
    || createTraeAutomationDriver({
      ...(options.automationOptions || {}),
      debug: debugEnabled,
    })) as AutomationGatewayDriver;
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
