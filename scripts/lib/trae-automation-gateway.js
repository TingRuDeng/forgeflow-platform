import http from "node:http";
import { createTraeAutomationDriver } from "./trae-dom-driver.js";
import { normalizeAutomationError } from "./trae-automation-errors.js";
import { createSessionStore, DEFAULT_STATE_DIR } from "./trae-automation-session-store.js";
class ApiError extends Error {
    code;
    statusCode;
    details;
    constructor(code, message, statusCode, details = {}) {
        super(message);
        this.name = "ApiError";
        this.code = code;
        this.statusCode = statusCode;
        this.details = details;
    }
}
function writeJson(res, statusCode, payload) {
    res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(payload));
}
function writeSuccess(res, statusCode, data) {
    writeJson(res, statusCode, {
        success: true,
        code: "OK",
        data,
    });
}
function writeError(res, error) {
    const normalized = error instanceof ApiError
        ? error
        : new ApiError(error?.code || "INTERNAL_ERROR", error?.message || "Internal server error", 500, error?.details || {});
    writeJson(res, normalized.statusCode, {
        success: false,
        code: normalized.code,
        message: normalized.message,
        details: normalized.details || {},
    });
}
function isTimeoutError(error) {
    if (!error) {
        return false;
    }
    if (error.code === "AUTOMATION_RESPONSE_TIMEOUT") {
        return true;
    }
    const message = error instanceof Error ? error.message : String(error?.message || "");
    return /request timeout/i.test(message)
        || /timed out waiting for trae to finish responding/i.test(message);
}
function parseDiscoveryFromQuery(query = {}) {
    const titleContains = String(query.title_contains || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    const urlContains = String(query.url_contains || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    const discovery = {};
    if (titleContains.length > 0) {
        discovery.titleContains = titleContains;
    }
    if (urlContains.length > 0) {
        discovery.urlContains = urlContains;
    }
    return Object.keys(discovery).length > 0 ? discovery : null;
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
    const automationDriver = options.automationDriver || createTraeAutomationDriver(options.automationOptions || {});
    const sessionStore = options.sessionStore || null;
    const method = String(input.method || "GET").toUpperCase();
    const pathname = input.pathname || "/";
    const query = input.query || {};
    const body = input.body ?? {};
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
    if (method === "POST" && pathname === "/v1/sessions/prepare") {
        try {
            const bodyObj = body;
            let sessionId = bodyObj.sessionId || null;
            if (sessionStore && !sessionId) {
                const session = sessionStore.create({
                    requestFingerprint: bodyObj.content || null,
                });
                sessionId = session.sessionId;
            }
            const result = await automationDriver.prepareSession(bodyObj);
            return {
                status: 200,
                json: {
                    success: true,
                    code: "OK",
                    data: {
                        ...result,
                        sessionId,
                    },
                },
            };
        }
        catch (error) {
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
        const bodyObj = body;
        const content = String(bodyObj.content || "").trim();
        if (!content) {
            throw new ApiError("INVALID_REQUEST", "content is required", 400);
        }
        const sessionId = bodyObj.sessionId || null;
        let session = null;
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
                prepare: bodyObj.prepare !== false,
                discovery: bodyObj.discovery || null,
                responseRequiredPrefix: bodyObj.responseRequiredPrefix || undefined,
                responseTimeoutMs: bodyObj.responseTimeoutMs || undefined,
                onProgress: sessionStore && sessionId ? (details) => {
                    sessionStore.touchActivity(sessionId, details);
                } : undefined,
            });
            if (sessionStore && sessionId) {
                sessionStore.markCompleted(sessionId, {
                    responseText: result?.response?.text || "",
                });
            }
            return {
                status: 200,
                json: {
                    success: true,
                    code: "OK",
                    data: result,
                },
            };
        }
        catch (error) {
            if (sessionStore && sessionId && !isTimeoutError(error)) {
                sessionStore.markFailed(sessionId, error?.message || "Unknown error");
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
            console.log(`[trae-gateway] pruned ${pruned} expired sessions`);
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
