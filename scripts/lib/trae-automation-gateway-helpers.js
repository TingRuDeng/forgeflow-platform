export class ApiError extends Error {
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
export function normalizeApiError(error) {
    return error instanceof ApiError
        ? error
        : new ApiError(error?.code || "INTERNAL_ERROR", error?.message || "Internal server error", 500, error?.details || {});
}
export function isTimeoutError(error) {
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
export function parseDiscoveryFromQuery(query = {}) {
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
