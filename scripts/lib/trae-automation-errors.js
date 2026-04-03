export class TraeAutomationError extends Error {
    code;
    details;
    constructor(code, message, details = {}) {
        super(message);
        this.name = "TraeAutomationError";
        this.code = code;
        this.details = details;
    }
}
export function normalizeAutomationError(error, fallbackCode = "AUTOMATION_ERROR", fallbackMessage = "Trae automation failed") {
    if (error instanceof TraeAutomationError) {
        return error;
    }
    const err = error;
    const normalized = new TraeAutomationError(String(err?.code || fallbackCode), String(err?.message || fallbackMessage), err?.details || {});
    if (err?.stack && typeof err.stack === "string") {
        normalized.stack = err.stack;
    }
    return normalized;
}
