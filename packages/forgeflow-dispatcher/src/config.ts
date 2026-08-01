import crypto from "node:crypto";
import path from "node:path";

import {
  readSecureConfigFile,
  repairSecureConfigFilePermissions,
  writeSecureConfigFile,
  type SecureConfigFilePolicy,
} from "@tingrudeng/beta-runtime-core/runtime/secure-config-file.js";

import { CONFIG_DIR, DEFAULT_CONFIG_PATH, DEFAULT_STATE_DIR } from "./paths.ts";

export type DispatcherAuthMode = "legacy" | "token" | "open";
export type PersistenceBackend = "json" | "sqlite";

export interface DispatcherRuntimeConfig {
  host: string;
  port: number;
  stateDir: string;
  persistenceBackend: PersistenceBackend;
  authMode: DispatcherAuthMode;
  apiToken?: string;
}

const CONFIG_POLICY: SecureConfigFilePolicy = {
  label: "dispatcher config",
  privateDirectory: CONFIG_DIR,
};

function assertValidApiToken(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) {
    throw new Error("dispatcher config apiToken must be a non-empty string without surrounding whitespace");
  }
}

export function getConfigPath() {
  return path.resolve(process.env.FORGEFLOW_DISPATCHER_CONFIG_PATH || DEFAULT_CONFIG_PATH);
}

export function buildDefaultConfig(): DispatcherRuntimeConfig {
  return {
    host: "127.0.0.1",
    port: 8787,
    stateDir: DEFAULT_STATE_DIR,
    persistenceBackend: "sqlite",
    authMode: "token",
    apiToken: crypto.randomBytes(24).toString("hex"),
  };
}

export function secureConfigPermissions(): string {
  return repairSecureConfigFilePermissions(getConfigPath(), CONFIG_POLICY);
}

export function loadConfig(): DispatcherRuntimeConfig {
  const content = readSecureConfigFile(getConfigPath(), CONFIG_POLICY);
  if (content === null) {
    return buildDefaultConfig();
  }
  const raw = JSON.parse(content) as Partial<DispatcherRuntimeConfig>;
  const config = {
    ...buildDefaultConfig(),
    ...raw,
  };
  assertValidApiToken(config.apiToken);
  return config;
}

export function saveConfig(config: DispatcherRuntimeConfig): string {
  assertValidApiToken(config.apiToken);
  return writeSecureConfigFile(
    getConfigPath(),
    `${JSON.stringify(config, null, 2)}\n`,
    CONFIG_POLICY,
  );
}
