import { createAutomationGatewayDebugLogger, handleAutomationGatewayRequest, isAutomationGatewayDebugEnabled, startAutomationGatewayHttpServer, } from "@tingrudeng/automation-gateway-core";
import { createTraeAutomationDriver } from "./trae-dom-driver.js";
import { normalizeAutomationError } from "./trae-automation-errors.js";
import { createSessionStore, DEFAULT_STATE_DIR } from "./trae-automation-session-store.js";
import { logger as scriptLogger } from "./logger.js";
export async function handleTraeAutomationHttpRequest(input, options = {}) {
    const automationDriver = (options.automationDriver || createTraeAutomationDriver(options.automationOptions || {}));
    return handleAutomationGatewayRequest(input, {
        automationDriver,
        sessionStore: options.sessionStore || null,
        debugLog: options.debugLog,
        normalizeAutomationError: normalizeTraeGatewayError,
    });
}
function normalizeTraeGatewayError(error, fallbackCode) {
    const normalized = normalizeAutomationError(error, fallbackCode);
    return {
        code: normalized.code || fallbackCode,
        message: normalized.message || "Trae automation failed",
        details: normalized.details || {},
    };
}
export async function startTraeAutomationGateway(options = {}) {
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
    }));
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
