import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

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

export function getConfigPath() {
  return process.env.FORGEFLOW_DISPATCHER_CONFIG_PATH || DEFAULT_CONFIG_PATH;
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

function assertSecureConfigFilePermissions(configPath: string): void {
  if (process.platform === "win32") {
    return;
  }

  if ((fs.statSync(configPath).mode & 0o077) !== 0) {
    throw new Error(
      `insecure dispatcher config permissions for ${configPath} (expected 600). Fix: chmod 600 ${configPath}`,
    );
  }
}

export function loadConfig(): DispatcherRuntimeConfig {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return buildDefaultConfig();
  }

  assertSecureConfigFilePermissions(configPath);
  const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as Partial<DispatcherRuntimeConfig>;
  return {
    ...buildDefaultConfig(),
    ...raw,
  };
}

export function saveConfig(config: DispatcherRuntimeConfig): string {
  const configPath = getConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  if (process.platform !== "win32") {
    fs.chmodSync(configPath, 0o600);
  }
  return configPath;
}
