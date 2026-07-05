import fs from "node:fs";
import path from "node:path";
import { spawn, ChildProcess } from "node:child_process";

import { discoverTraeTarget, getDebuggerVersion, DiscoverTraeTargetResult, DebuggerVersion } from "./trae-cdp-discovery.js";
import {
  prepareCleanRelaunch,
  quitExistingMacApp,
  resolveMacAppName,
  waitForDebuggerPortToDrain,
} from "./trae-launcher-clean-relaunch.js";
import {
  resolveMacAppBundleExecutable,
} from "@tingrudeng/automation-gateway-core";
export const DEFAULT_START_TIMEOUT_MS = Number(process.env.TRAE_CDP_START_TIMEOUT_MS || 15000);
export const DEFAULT_REMOTE_DEBUGGING_PORT = Number(process.env.TRAE_REMOTE_DEBUGGING_PORT || 9222);
export { prepareCleanRelaunch, quitExistingMacApp, resolveMacAppName, resolveMacAppBundleExecutable, waitForDebuggerPortToDrain };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function onceChildEvent(child: ChildProcess, eventName: "error"): Promise<Error | null> {
  return new Promise((resolve) => {
    if (!child || typeof child.once !== "function") {
      resolve(null);
      return;
    }
    child.once(eventName, resolve as () => Error | null);
  });
}

export function parseLaunchArgs(value: unknown): string[] {
  if (!value) {
    return [];
  }
  return String(value)
    .split(" ")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function hasRemoteDebuggingPortArg(args: string[] = []): boolean {
  return args.some((arg) => /^--remote-debugging-port=/.test(arg));
}

export interface ResolveTraeLaunchTargetOptions {
  env?: NodeJS.ProcessEnv;
  fsImpl?: typeof fs;
  pathImpl?: typeof path;
  platform?: string;
  remoteDebuggingPort?: number | string;
  traeBin?: string;
  projectPath?: string;
  traeArgs?: string | string[];
}

export interface TraeLaunchTarget {
  bundlePath: string;
  command: string;
  args: string[];
  projectPath: string;
  remoteDebuggingPort: number;
}

export function resolveTraeLaunchTarget(options: ResolveTraeLaunchTargetOptions = {}): TraeLaunchTarget {
  const env = options.env || process.env;
  const fsImpl = options.fsImpl || fs;
  const pathImpl = options.pathImpl || path;
  const remoteDebuggingPort = Number(options.remoteDebuggingPort || env.TRAE_REMOTE_DEBUGGING_PORT || DEFAULT_REMOTE_DEBUGGING_PORT);

  const configuredCommand = String(options.traeBin || env.TRAE_BIN || "").trim();
  if (!configuredCommand) {
    throw new Error("TRAE_BIN or --trae-bin is required");
  }

  const projectPath = String(options.projectPath || env.TRAE_PROJECT_PATH || "").trim();
  if (!projectPath) {
    throw new Error("TRAE_PROJECT_PATH or --project-path is required");
  }
  if (!fsImpl.existsSync(projectPath)) {
    throw new Error(`project path does not exist: ${projectPath}`);
  }

  const command = resolveMacAppBundleExecutable(configuredCommand, {
    fsImpl,
    pathImpl,
    platform: options.platform || process.platform,
  });
  const args = parseLaunchArgs(options.traeArgs || env.TRAE_ARGS || "");
  if (!hasRemoteDebuggingPortArg(args)) {
    args.push(`--remote-debugging-port=${remoteDebuggingPort}`);
  }
  if (!args.includes(projectPath)) {
    args.push(projectPath);
  }

  return {
    bundlePath: configuredCommand,
    command,
    args,
    projectPath,
    remoteDebuggingPort,
  };
}

export interface WaitForTraeDebuggerOptions {
  discoverTarget?: typeof discoverTraeTarget;
  getVersion?: typeof getDebuggerVersion;
  sleepImpl?: typeof sleep;
  timeoutMs?: number | string;
  waitForTarget?: boolean;
  port?: number | string;
  titleContains?: string[];
  urlContains?: string[];
}

export async function waitForTraeDebugger(options: WaitForTraeDebuggerOptions = {}): Promise<{ version: DebuggerVersion; target: DiscoverTraeTargetResult['target'] | null }> {
  const discoverTargetImpl = options.discoverTarget || discoverTraeTarget;
  const getVersionImpl = options.getVersion || getDebuggerVersion;
  const sleepImpl = options.sleepImpl || sleep;
  const timeoutMs = Number(options.timeoutMs || DEFAULT_START_TIMEOUT_MS);
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

export interface LaunchTraeForAutomationOptions extends ResolveTraeLaunchTargetOptions {
  spawnImpl?: typeof spawn;
  titleContains?: string[];
  forceCleanLaunch?: boolean;
  cleanRelaunchDrainTimeoutMs?: number | string;
  quitExistingApp?: typeof quitExistingMacApp;
  preferExisting?: boolean;
  waitForTarget?: boolean;
  timeoutMs?: number | string;
  discoverTarget?: typeof discoverTraeTarget;
  getVersion?: typeof getDebuggerVersion;
  sleepImpl?: typeof sleep;
  detached?: boolean;
  stdio?: "ignore" | "inherit" | "pipe";
}

export interface LaunchTraeResult extends TraeLaunchTarget {
  titleContains: string[];
  debuggerInfo: { version: DebuggerVersion; target: DiscoverTraeTargetResult['target'] | null };
  reusedExisting: boolean;
}
function buildLaunchResult(
  target: TraeLaunchTarget,
  titleContains: string[],
  debuggerInfo: LaunchTraeResult["debuggerInfo"],
  reusedExisting: boolean,
): LaunchTraeResult {
  return {
    bundlePath: target.bundlePath,
    command: target.command,
    args: target.args,
    projectPath: target.projectPath,
    remoteDebuggingPort: target.remoteDebuggingPort,
    titleContains,
    debuggerInfo,
    reusedExisting,
  };
}
export async function launchTraeForAutomation(options: LaunchTraeForAutomationOptions = {}): Promise<LaunchTraeResult> {
  const spawnImpl = options.spawnImpl || spawn;
  const titleContains = options.titleContains || [path.basename(String(options.projectPath || "").trim())].filter(Boolean);
  const target = resolveTraeLaunchTarget(options);
  const platform = options.platform || process.platform;
  const forceCleanLaunch = options.forceCleanLaunch === true;
  const preferExisting = !forceCleanLaunch && options.preferExisting !== false;

  if (preferExisting) {
    try {
      const existingDebuggerInfo = await waitForTraeDebugger({
        port: target.remoteDebuggingPort,
        titleContains,
        waitForTarget: options.waitForTarget !== false,
        timeoutMs: Math.min(Number(options.timeoutMs || DEFAULT_START_TIMEOUT_MS), 1500),
        discoverTarget: options.discoverTarget,
        getVersion: options.getVersion,
        sleepImpl: options.sleepImpl,
      });

      return buildLaunchResult(target, titleContains, existingDebuggerInfo, true);
    } catch {
      // 没有可复用调试目标时，继续拉起新的 Trae 进程。
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

  const debuggerInfo = await waitForSpawnedDebugger(child, target, titleContains, options);
  return buildLaunchResult(target, titleContains, debuggerInfo, false);
}

async function waitForSpawnedDebugger(
  child: ChildProcess,
  target: TraeLaunchTarget,
  titleContains: string[],
  options: LaunchTraeForAutomationOptions,
): Promise<LaunchTraeResult["debuggerInfo"]> {
  const debuggerPromise = waitForTraeDebugger({
    port: target.remoteDebuggingPort,
    titleContains,
    waitForTarget: options.waitForTarget !== false,
    timeoutMs: options.timeoutMs,
    discoverTarget: options.discoverTarget,
    getVersion: options.getVersion,
    sleepImpl: options.sleepImpl,
  });

  const spawnError = await Promise.race([
    debuggerPromise.then(() => null).catch(() => null),
    onceChildEvent(child, "error"),
  ]);

  if (spawnError) {
    throw new Error(`Failed to launch Trae: ${spawnError.message || String(spawnError)}`);
  }

  return debuggerPromise;
}
