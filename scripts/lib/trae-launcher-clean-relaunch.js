import path from "node:path";
import { execFile } from "node:child_process";
import { getDebuggerVersion } from "./trae-cdp-discovery.js";
export const DEFAULT_CLEAN_RELAUNCH_DRAIN_TIMEOUT_MS = Number(process.env.TRAE_CDP_CLEAN_RELAUNCH_DRAIN_TIMEOUT_MS || 5000);
export function resolveMacAppName(bundlePath, options = {}) {
    const pathImpl = options.pathImpl || path;
    const platform = options.platform || process.platform;
    const normalized = String(bundlePath || "").trim();
    if (platform !== "darwin" || !normalized.toLowerCase().endsWith(".app")) {
        return null;
    }
    return pathImpl.basename(normalized, ".app");
}
export async function quitExistingMacApp(options = {}) {
    const execFileImpl = options.execFileImpl || execFile;
    const sleepImpl = options.sleepImpl || defaultSleep;
    const appName = String(options.appName || "").trim();
    if (!appName) {
        return false;
    }
    await new Promise((resolve) => {
        execFileImpl("osascript", ["-e", `tell application "${appName}" to quit`], () => resolve(undefined));
    });
    await sleepImpl(Number(options.postQuitDelayMs || 1000));
    return true;
}
export async function waitForDebuggerPortToDrain(options = {}) {
    const getVersionImpl = options.getVersion || getDebuggerVersion;
    const sleepImpl = options.sleepImpl || defaultSleep;
    const timeoutMs = Number(options.timeoutMs || DEFAULT_CLEAN_RELAUNCH_DRAIN_TIMEOUT_MS);
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        try {
            await getVersionImpl({ port: options.port });
            await sleepImpl(250);
        }
        catch {
            return;
        }
    }
    throw new Error(`Existing Trae debugger endpoint on port ${options.port} did not drain within ${timeoutMs}ms`);
}
export async function prepareCleanRelaunch(options) {
    const platform = options.platform || process.platform;
    const appName = resolveMacAppName(options.bundlePath, { platform });
    if (!appName) {
        return false;
    }
    const quitExistingAppImpl = options.quitExistingApp || quitExistingMacApp;
    await quitExistingAppImpl({
        appName,
        bundlePath: options.bundlePath,
        platform,
        sleepImpl: options.sleepImpl,
    });
    await waitForDebuggerPortToDrain({
        port: options.port,
        timeoutMs: options.timeoutMs,
        getVersion: options.getVersion,
        sleepImpl: options.sleepImpl,
    });
    return true;
}
function defaultSleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
