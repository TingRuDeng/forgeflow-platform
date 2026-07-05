import { discoverTraeTarget, getDebuggerVersion } from "./trae-cdp-discovery.js";
import {
  prepareCleanRelaunch,
  quitExistingMacApp,
  resolveMacAppName,
  waitForDebuggerPortToDrain,
} from "./trae-launcher-clean-relaunch.js";
import {
  hasRemoteDebuggingPortArg,
  launchTraeForAutomation as launchSharedTraeForAutomation,
  parseLaunchArgs,
  resolveMacAppBundleExecutable,
  resolveTraeLaunchTarget as resolveSharedTraeLaunchTarget,
  waitForTraeDebugger as waitForSharedTraeDebugger,
} from "@tingrudeng/automation-gateway-core";
import type {
  LaunchTraeForAutomationOptions,
  LaunchTraeResult,
  ResolveTraeLaunchTargetOptions,
  TraeLaunchTarget,
  WaitForTraeDebuggerOptions,
} from "@tingrudeng/automation-gateway-core";
export const DEFAULT_START_TIMEOUT_MS = Number(process.env.TRAE_CDP_START_TIMEOUT_MS || 15000);
export const DEFAULT_REMOTE_DEBUGGING_PORT = Number(process.env.TRAE_REMOTE_DEBUGGING_PORT || 9222);
export {
  hasRemoteDebuggingPortArg,
  parseLaunchArgs,
  prepareCleanRelaunch,
  quitExistingMacApp,
  resolveMacAppBundleExecutable,
  resolveMacAppName,
  waitForDebuggerPortToDrain,
};

export function resolveTraeLaunchTarget(options: ResolveTraeLaunchTargetOptions = {}): TraeLaunchTarget {
  return resolveSharedTraeLaunchTarget({
    defaultRemoteDebuggingPort: DEFAULT_REMOTE_DEBUGGING_PORT,
    ...options,
  });
}

export async function waitForTraeDebugger(options: WaitForTraeDebuggerOptions = {}) {
  return waitForSharedTraeDebugger({
    ...options,
    defaultStartTimeoutMs: DEFAULT_START_TIMEOUT_MS,
    discoverTarget: options.discoverTarget || discoverTraeTarget,
    getVersion: options.getVersion || getDebuggerVersion,
  });
}

export async function launchTraeForAutomation(options: LaunchTraeForAutomationOptions = {}): Promise<LaunchTraeResult> {
  return launchSharedTraeForAutomation({
    ...options,
    defaultRemoteDebuggingPort: DEFAULT_REMOTE_DEBUGGING_PORT,
    defaultStartTimeoutMs: DEFAULT_START_TIMEOUT_MS,
    discoverTarget: options.discoverTarget || discoverTraeTarget,
    getVersion: options.getVersion || getDebuggerVersion,
  });
}
