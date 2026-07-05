import http from "node:http";
import { ApiError, handleAutomationGatewayRequest, normalizeApiError, } from "@tingrudeng/automation-gateway-core";
import { createTraeAutomationDriver } from "./trae-dom-driver.js";
import { normalizeAutomationError } from "./trae-automation-errors.js";
import { createSessionStore, DEFAULT_STATE_DIR } from "./trae-automation-session-store.js";
import { logger } from "./logger.js";
function writeJson(res, statusCode, payload) {
    res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(payload));
}
function writeError(res, error) {
    const normalized = normalizeApiError(error);
    writeJson(res, normalized.statusCode, {
        success: false,
        code: normalized.code,
        message: normalized.message,
        details: normalized.details || {},
    });
}
async function readJsonBody(req) {
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
            }
            catch {
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
export async function handleTraeAutomationHttpRequest(input, options = {}) {
    const automationDriver = (options.automationDriver || createTraeAutomationDriver(options.automationOptions || {}));
    return handleAutomationGatewayRequest(input, {
        automationDriver,
        sessionStore: options.sessionStore || null,
        debugLog: options.debugLog,
        normalizeAutomationError: (error, fallbackCode) => {
            const normalized = normalizeAutomationError(error, fallbackCode);
            return {
                code: normalized.code || fallbackCode,
                message: normalized.message || "Trae automation failed",
                details: normalized.details || {},
            };
        },
    });
}
export async function startTraeAutomationGateway(options = {}) {
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
        }
        catch (error) {
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
