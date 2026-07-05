import path from "node:path";
import { execFile } from "node:child_process";

import { getDebuggerVersion } from "./trae-cdp-discovery.js";

type Sleep = (ms: number) => Promise<void>;

export const DEFAULT_CLEAN_RELAUNCH_DRAIN_TIMEOUT_MS = Number(
  process.env.TRAE_CDP_CLEAN_RELAUNCH_DRAIN_TIMEOUT_MS || 5000,
);

export function resolveMacAppName(bundlePath: string, options: { pathImpl?: typeof path; platform?: string } = {}): string | null {
  const pathImpl = options.pathImpl || path;
  const platform = options.platform || process.platform;
  const normalized = String(bundlePath || "").trim();
  if (platform !== "darwin" || !normalized.toLowerCase().endsWith(".app")) {
    return null;
  }
  return pathImpl.basename(normalized, ".app");
}

export async function quitExistingMacApp(options: {
  appName?: string;
  bundlePath?: string;
  platform?: string;
  execFileImpl?: typeof execFile;
  postQuitDelayMs?: number | string;
  sleepImpl?: Sleep;
} = {}): Promise<boolean> {
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

export async function waitForDebuggerPortToDrain(options: {
  getVersion?: typeof getDebuggerVersion;
  sleepImpl?: Sleep;
  timeoutMs?: number | string;
  port?: number | string;
} = {}): Promise<void> {
  const getVersionImpl = options.getVersion || getDebuggerVersion;
  const sleepImpl = options.sleepImpl || defaultSleep;
  const timeoutMs = Number(options.timeoutMs || DEFAULT_CLEAN_RELAUNCH_DRAIN_TIMEOUT_MS);
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await getVersionImpl({ port: options.port });
      await sleepImpl(250);
    } catch {
      return;
    }
  }

  throw new Error(`Existing Trae debugger endpoint on port ${options.port} did not drain within ${timeoutMs}ms`);
}

export async function prepareCleanRelaunch(options: {
  bundlePath: string;
  platform?: string;
  port?: number | string;
  timeoutMs?: number | string;
  getVersion?: typeof getDebuggerVersion;
  sleepImpl?: Sleep;
  quitExistingApp?: typeof quitExistingMacApp;
}): Promise<boolean> {
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

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
