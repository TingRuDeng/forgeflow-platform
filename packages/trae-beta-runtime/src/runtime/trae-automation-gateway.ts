import type { Server } from "node:http";

import {
  createAutomationGatewayDebugLogger,
  handleAutomationGatewayRequest,
  isAutomationGatewayDebugEnabled,
  resolveAutomationGatewayDriver,
  startAutomationGatewayHttpServer,
  type AutomationGatewayDriver,
  type NormalizedAutomationError,
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
  server: Server;
  sessionStore: SessionStore | null;
  close: () => Promise<void>;
}

export async function handleTraeAutomationHttpRequest(
  input: HttpRequestInput,
  options: HandleTraeAutomationHttpRequestOptions = {},
): Promise<{ status: number; json: ApiSuccessResponse<unknown> | ApiErrorResponse }> {
  const automationDriver = resolveAutomationGatewayDriver({
    automationDriver: options.automationDriver,
    automationOptions: options.automationOptions,
    createDriver: createTraeAutomationDriver as (driverOptions: Record<string, unknown>) => AutomationGatewayDriver,
  });
  return handleAutomationGatewayRequest(input, {
    automationDriver,
    sessionStore: options.sessionStore || null,
    debugLog: options.debugLog,
    normalizeAutomationError: normalizeTraeGatewayError,
  });
}

function normalizeTraeGatewayError(error: unknown, fallbackCode: string): NormalizedAutomationError {
  const normalized = normalizeAutomationError(error, fallbackCode) as Error & {
    code?: string;
    details?: Record<string, unknown>;
  };
  return {
    code: normalized.code || fallbackCode,
    message: normalized.message || "Trae automation failed",
    details: normalized.details || {},
  };
}

export function startTraeAutomationGateway(
  options: StartTraeAutomationGatewayOptions = {},
): Promise<StartedTraeAutomationGateway> {
  const host = options.host || "127.0.0.1";
  const port = options.port === undefined ? 8790 : Number(options.port);
  const stateDir = options.stateDir ?? DEFAULT_STATE_DIR;
  const logger = options.logger || console;
  const debugEnabled = isAutomationGatewayDebugEnabled(options.debug);
  const debugLog = createAutomationGatewayDebugLogger(debugEnabled, logger);
  const automationDriver = resolveAutomationGatewayDriver({
    automationDriver: options.automationDriver,
    automationOptions: options.automationOptions,
    createDriver: createTraeAutomationDriver as (driverOptions: Record<string, unknown>) => AutomationGatewayDriver,
    debugEnabled,
  });
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

  return startAutomationGatewayHttpServer({
    host,
    port,
    debugLog,
    handlerOptions: {
      automationDriver,
      sessionStore,
      debugLog,
      normalizeAutomationError: normalizeTraeGatewayError,
    },
  }).then((started) => ({
    ...started,
    sessionStore,
  }));
}
