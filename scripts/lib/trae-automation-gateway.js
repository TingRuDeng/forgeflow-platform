import { handleAutomationGatewayRequest, startAutomationGatewayHttpServer, } from "@tingrudeng/automation-gateway-core";
import { createTraeAutomationDriver } from "./trae-dom-driver.js";
import { normalizeAutomationError } from "./trae-automation-errors.js";
import { createSessionStore, DEFAULT_STATE_DIR } from "./trae-automation-session-store.js";
import { logger } from "./logger.js";
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
    const automationDriver = (options.automationDriver || createTraeAutomationDriver(options.automationOptions || {}));
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
    const started = await startAutomationGatewayHttpServer({
        host,
        port,
        handlerOptions: {
            automationDriver,
            sessionStore,
            normalizeAutomationError: normalizeTraeGatewayError,
        },
    });
    return {
        ...started,
        sessionStore,
    };
}
