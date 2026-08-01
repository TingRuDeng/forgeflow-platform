import os from "node:os";
import path from "node:path";

import {
  readSecureConfigFile,
  repairSecureConfigFilePermissions,
  writeSecureConfigFile,
} from "@tingrudeng/beta-runtime-core/runtime/secure-config-file.js";
import { normalizeOptionalDispatcherToken } from "@tingrudeng/beta-runtime-core/runtime/dispatcher-auth.js";

export interface CliConfig {
  dispatcherToken?: string;
  dispatcherUrl?: string;
}

const CONFIG_FILENAME = ".forgeflow-review-orchestrator.json";
const CONFIG_POLICY = {
  label: "review orchestrator config",
};

function getConfigPath(): string {
  return path.resolve(os.homedir(), CONFIG_FILENAME);
}

export function secureConfigPermissions(): string {
  return repairSecureConfigFilePermissions(getConfigPath(), CONFIG_POLICY);
}

export function loadConfig(): CliConfig {
  const content = readSecureConfigFile(getConfigPath(), CONFIG_POLICY);
  if (content === null) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  const config = parsed as CliConfig;
  return {
    ...config,
    dispatcherToken: normalizeOptionalDispatcherToken(
      config.dispatcherToken,
      "review orchestrator config dispatcherToken",
    ),
  };
}

export function saveConfig(config: CliConfig): void {
  const normalizedConfig = {
    ...config,
    dispatcherToken: normalizeOptionalDispatcherToken(
      config.dispatcherToken,
      "review orchestrator config dispatcherToken",
    ),
  };
  writeSecureConfigFile(getConfigPath(), JSON.stringify(normalizedConfig, null, 2), CONFIG_POLICY);
}

export function getDispatcherToken(): string | undefined {
  const environmentToken = normalizeOptionalDispatcherToken(
    process.env.DISPATCHER_API_TOKEN,
    "DISPATCHER_API_TOKEN",
  );
  return environmentToken ?? loadConfig().dispatcherToken;
}
