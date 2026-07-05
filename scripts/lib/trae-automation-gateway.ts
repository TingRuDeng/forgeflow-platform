import type { Server } from "node:http";
import {
  createAutomationGatewayDebugLogger,
  handleAutomationGatewayRequest,
  isAutomationGatewayDebugEnabled,
  startAutomationGatewayHttpServer,
  type AutomationGatewayDriver,
  type NormalizedAutomationError,
} from "@tingrudeng/automation-gateway-core";

import { createTraeAutomationDriver, TraeAutomationDriver } from "./trae-dom-driver.js";
import { normalizeAutomationError } from "./trae-automation-errors.js";
import { createSessionStore, SessionStore, DEFAULT_STATE_DIR } from "./trae-automation-session-store.js";
import { logger as scriptLogger } from "./logger.js";

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

export async function handleTraeAutomationHttpRequest(input: HandleTraeAutomationHttpRequestInput, options: HandleTraeAutomationHttpRequestOptions = {}): Promise<{ status: number; json: unknown }> {
  const automationDriver = (options.automationDriver || createTraeAutomationDriver(options.automationOptions || {})) as AutomationGatewayDriver;
  return handleAutomationGatewayRequest(input, {
    automationDriver,
    sessionStore: options.sessionStore || null,
    debugLog: options.debugLog,
    normalizeAutomationError: normalizeTraeGatewayError,
  });
}

function normalizeTraeGatewayError(error: unknown, fallbackCode: string): NormalizedAutomationError {
  const normalized = normalizeAutomationError(error, fallbackCode);
  return {
    code: normalized.code || fallbackCode,
    message: normalized.message || "Trae automation failed",
    details: normalized.details || {},
  };
}

export interface StartTraeAutomationGatewayOptions {
  host?: string;
  port?: number | string;
  stateDir?: string | null;
  automationDriver?: TraeAutomationDriver;
  automationOptions?: Record<string, unknown>;
  sessionStore?: SessionStore | null;
  logger?: Pick<typeof console, "log" | "warn">;
  debug?: boolean;
}

export interface TraeAutomationGateway {
  host: string;
  port: number;
  baseUrl: string;
  server: Server;
  sessionStore: SessionStore | null;
  close: () => Promise<void>;
}

export async function startTraeAutomationGateway(options: StartTraeAutomationGatewayOptions = {}): Promise<TraeAutomationGateway> {
  const host = options.host || "127.0.0.1";
  const port = options.port === undefined ? 8790 : Number(options.port);
  const stateDir = options.stateDir ?? DEFAULT_STATE_DIR;
  const debugEnabled = isAutomationGatewayDebugEnabled(options.debug);
  const debugLog = createAutomationGatewayDebugLogger(debugEnabled, options.logger || console);
  const automationOptions = options.automationOptions || {};
  const driverDebug = debugEnabled
    || automationOptions.debug === true
    || String(automationOptions.debug || "").trim() === "1";
  const automationDriver = (options.automationDriver || createTraeAutomationDriver({
    ...automationOptions,
    debug: driverDebug,
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
      scriptLogger.info({ event: "session_pruned", prunedCount: pruned });
      debugLog("session.pruned", { pruned });
    }
  }

  const started = await startAutomationGatewayHttpServer({
    host,
    port,
    debugLog,
    handlerOptions: {
      automationDriver,
      sessionStore,
      debugLog,
      normalizeAutomationError: normalizeTraeGatewayError,
    },
  });
  return {
    ...started,
    sessionStore,
  };
}
