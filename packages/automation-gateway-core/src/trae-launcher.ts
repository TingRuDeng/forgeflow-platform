import { spawn } from "node:child_process";
import path from "node:path";

import { discoverTraeTarget, getDebuggerVersion } from "./trae-cdp-discovery.js";
import {
  prepareCleanRelaunch,
  quitExistingMacApp,
} from "./trae-clean-relaunch.js";
import {
  resolveTraeLaunchTarget,
} from "./trae-launch-target.js";
import type {
  ResolveTraeLaunchTargetOptions,
  TraeLaunchTarget,
} from "./trae-launch-target.js";

export interface TraeDebuggerInfo {
  version: Record<string, unknown>;
  target: Record<string, unknown> | null;
}

export type TraeDiscoverTarget = (options?: Record<string, unknown>) => Promise<{
  version: Record<string, unknown>;
  target: Record<string, unknown>;
}>;

export type TraeGetDebuggerVersion = (options?: Record<string, unknown>) => Promise<Record<string, unknown>>;

export type TraeLauncherSleep = (ms: number) => Promise<void>;

export interface TraeLaunchChildProcess {
  once?(eventName: "error", handler: (error: Error) => void): unknown;
  unref?(): void;
}

export type TraeSpawnProcess = (
  command: string,
  args: string[],
  options: {
    detached: boolean;
    env: Record<string, string | undefined>;
    stdio: "ignore" | "inherit" | "pipe";
  },
) => TraeLaunchChildProcess;

export interface WaitForTraeDebuggerOptions {
  defaultStartTimeoutMs?: number | string;
  discoverTarget?: TraeDiscoverTarget;
  getVersion?: TraeGetDebuggerVersion;
  sleepImpl?: TraeLauncherSleep;
  timeoutMs?: number | string;
  waitForTarget?: boolean;
  port?: number | string;
  titleContains?: string[];
  urlContains?: string[];
}

export interface LaunchTraeForAutomationOptions extends ResolveTraeLaunchTargetOptions {
  cleanRelaunchDrainTimeoutMs?: number | string;
  defaultStartTimeoutMs?: number | string;
  detached?: boolean;
  discoverTarget?: TraeDiscoverTarget;
  getVersion?: TraeGetDebuggerVersion;
  preferExisting?: boolean;
  quitExistingApp?: typeof quitExistingMacApp;
  sleepImpl?: TraeLauncherSleep;
  spawnImpl?: TraeSpawnProcess;
  stdio?: "ignore" | "inherit" | "pipe";
  timeoutMs?: number | string;
  titleContains?: string[];
  forceCleanLaunch?: boolean;
  waitForTarget?: boolean;
}

export interface LaunchTraeResult extends TraeLaunchTarget {
  debuggerInfo: TraeDebuggerInfo;
  reusedExisting: boolean;
  titleContains: string[];
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function onceChildError(child: TraeLaunchChildProcess): Promise<Error | null> {
  return new Promise((resolve) => {
    if (!child || typeof child.once !== "function") {
      resolve(null);
      return;
    }
    child.once("error", resolve);
  });
}

function buildLaunchResult(
  target: TraeLaunchTarget,
  titleContains: string[],
  debuggerInfo: TraeDebuggerInfo,
  reusedExisting: boolean,
): LaunchTraeResult {
  return {
    bundlePath: target.bundlePath,
    command: target.command,
    args: target.args,
    projectPath: target.projectPath,
    remoteDebuggingPort: target.remoteDebuggingPort,
    debuggerInfo,
    reusedExisting,
    titleContains,
  };
}

export async function waitForTraeDebugger(options: WaitForTraeDebuggerOptions = {}): Promise<TraeDebuggerInfo> {
  const discoverTargetImpl = options.discoverTarget || discoverTraeTarget;
  const getVersionImpl = options.getVersion || getDebuggerVersion;
  const sleepImpl = options.sleepImpl || defaultSleep;
  const timeoutMs = Number(options.timeoutMs || options.defaultStartTimeoutMs || 15000);
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      if (options.waitForTarget === false) {
        return {
          version: await getVersionImpl({ port: options.port }),
          target: null,
        };
      }
      return await discoverTargetImpl({
        port: options.port,
        titleContains: options.titleContains,
        urlContains: options.urlContains,
      });
    } catch {
      await sleepImpl(250);
    }
  }

  throw new Error(`Trae did not expose a debugger target within ${timeoutMs}ms`);
}

export async function launchTraeForAutomation(options: LaunchTraeForAutomationOptions = {}): Promise<LaunchTraeResult> {
  const target = resolveTraeLaunchTarget(options);
  const platform = options.platform || process.platform;
  const titleContains = options.titleContains || [path.basename(String(target.projectPath || "").trim())].filter(Boolean);
  const forceCleanLaunch = options.forceCleanLaunch === true;
  const preferExisting = !forceCleanLaunch && options.preferExisting !== false;

  if (preferExisting) {
    const reusedResult = await tryReuseExistingDebugger(target, titleContains, options);
    if (reusedResult) {
      return reusedResult;
    }
  }
  if (forceCleanLaunch && platform === "darwin") {
    await prepareCleanRelaunch({
      bundlePath: target.bundlePath,
      platform,
      port: target.remoteDebuggingPort,
      timeoutMs: options.cleanRelaunchDrainTimeoutMs,
      getVersion: options.getVersion,
      sleepImpl: options.sleepImpl,
      quitExistingApp: options.quitExistingApp,
    });
  }

  const child = spawnTraeProcess(target, options);
  const debuggerInfo = await waitForSpawnedDebugger(child, target, titleContains, options);
  return buildLaunchResult(target, titleContains, debuggerInfo, false);
}

async function tryReuseExistingDebugger(
  target: TraeLaunchTarget,
  titleContains: string[],
  options: LaunchTraeForAutomationOptions,
): Promise<LaunchTraeResult | null> {
  try {
    const debuggerInfo = await waitForTraeDebugger({
      ...options,
      port: target.remoteDebuggingPort,
      titleContains,
      waitForTarget: options.waitForTarget !== false,
      timeoutMs: Math.min(Number(options.timeoutMs || options.defaultStartTimeoutMs || 15000), 1500),
    });
    return buildLaunchResult(target, titleContains, debuggerInfo, true);
  } catch {
    // 没有可复用调试目标时，继续拉起新的 Trae 进程。
    return null;
  }
}

function spawnTraeProcess(
  target: TraeLaunchTarget,
  options: LaunchTraeForAutomationOptions,
): TraeLaunchChildProcess {
  const spawnImpl = options.spawnImpl || (spawn as unknown as TraeSpawnProcess);
  const child = spawnImpl(target.command, target.args, {
    detached: options.detached !== false,
    stdio: options.stdio || "ignore",
    env: {
      ...process.env,
      ...(options.env || {}),
    },
  });

  if (typeof child.unref === "function") {
    child.unref();
  }
  return child;
}

async function waitForSpawnedDebugger(
  child: TraeLaunchChildProcess,
  target: TraeLaunchTarget,
  titleContains: string[],
  options: LaunchTraeForAutomationOptions,
): Promise<TraeDebuggerInfo> {
  const debuggerPromise = waitForTraeDebugger({
    ...options,
    port: target.remoteDebuggingPort,
    titleContains,
    waitForTarget: options.waitForTarget !== false,
    timeoutMs: options.timeoutMs,
  });

  const spawnError = await Promise.race([
    debuggerPromise.then(() => null).catch(() => null),
    onceChildError(child),
  ]);

  if (spawnError) {
    throw new Error(`Failed to launch Trae: ${spawnError.message || String(spawnError)}`);
  }

  return debuggerPromise;
}
