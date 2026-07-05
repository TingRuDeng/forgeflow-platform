// @ts-nocheck
import {
  DEFAULT_CLEAN_RELAUNCH_DRAIN_TIMEOUT_MS,
  hasRemoteDebuggingPortArg,
  launchTraeForAutomation as launchSharedTraeForAutomation,
  parseLaunchArgs,
  prepareCleanRelaunch,
  quitExistingMacApp,
  resolveMacAppBundleExecutable,
  resolveMacAppName,
  resolveTraeLaunchTarget as resolveSharedTraeLaunchTarget,
  waitForDebuggerPortToDrain,
  waitForTraeDebugger as waitForSharedTraeDebugger,
} from "@tingrudeng/automation-gateway-core";

import { discoverTraeTarget, getDebuggerVersion } from "./trae-cdp-discovery.js";

export const DEFAULT_START_TIMEOUT_MS = Number(process.env.TRAE_CDP_START_TIMEOUT_MS || 15000);
export const DEFAULT_REMOTE_DEBUGGING_PORT = Number(process.env.TRAE_REMOTE_DEBUGGING_PORT || 9222);
export {
  DEFAULT_CLEAN_RELAUNCH_DRAIN_TIMEOUT_MS,
  hasRemoteDebuggingPortArg,
  parseLaunchArgs,
  quitExistingMacApp,
  resolveMacAppBundleExecutable,
  resolveMacAppName,
  waitForDebuggerPortToDrain,
};

export function resolveTraeLaunchTarget(options = {}) {
  return resolveSharedTraeLaunchTarget({
    defaultRemoteDebuggingPort: DEFAULT_REMOTE_DEBUGGING_PORT,
    ...options,
  });
}

export async function waitForTraeDebugger(options = {}) {
  return waitForSharedTraeDebugger({
    ...options,
    defaultStartTimeoutMs: DEFAULT_START_TIMEOUT_MS,
    discoverTarget: options.discoverTarget || discoverTraeTarget,
    getVersion: options.getVersion || getDebuggerVersion,
  });
}

export async function launchTraeForAutomation(options = {}) {
  return launchSharedTraeForAutomation({
    ...options,
    defaultRemoteDebuggingPort: DEFAULT_REMOTE_DEBUGGING_PORT,
    defaultStartTimeoutMs: DEFAULT_START_TIMEOUT_MS,
    discoverTarget: options.discoverTarget || discoverTraeTarget,
    getVersion: options.getVersion || getDebuggerVersion,
  });
}
