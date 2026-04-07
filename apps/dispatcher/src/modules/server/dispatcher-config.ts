import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface DispatcherConfig {
  authMode?: "legacy" | "token" | "open";
  apiToken?: string;
  port?: number;
}

const CONFIG_FILENAME = ".forgeflow-dispatcher.json";
const CONFIG_PATH_ENV = "FORGEFLOW_DISPATCHER_CONFIG_PATH";
export type DispatcherAuthMode = "legacy" | "token" | "open";

function getConfigPath(): string {
  const override = process.env[CONFIG_PATH_ENV];
  if (override) {
    return override;
  }
  return path.join(os.homedir(), CONFIG_FILENAME);
}

function assertSecureConfigFilePermissions(configPath: string): void {
  if (process.platform === "win32") {
    return;
  }

  const stat = fs.statSync(configPath);
  if ((stat.mode & 0o077) !== 0) {
    throw new Error(
      `insecure dispatcher config permissions for ${configPath} (expected 600). Fix: chmod 600 ${configPath}`,
    );
  }
}

export function loadDispatcherConfig(): DispatcherConfig {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return {};
  }
  assertSecureConfigFilePermissions(configPath);
  const raw = fs.readFileSync(configPath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `failed to parse dispatcher config ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function getDispatcherAuthMode(): DispatcherAuthMode {
  const config = loadDispatcherConfig();
  const value = process.env.DISPATCHER_AUTH_MODE || config.authMode || "token";
  if (value === "legacy" || value === "token" || value === "open") {
    return value;
  }
  throw new Error(`invalid DISPATCHER_AUTH_MODE: ${value}`);
}

export function getDispatcherApiToken(): string | null {
  const config = loadDispatcherConfig();
  return process.env.DISPATCHER_API_TOKEN || config.apiToken || null;
}
