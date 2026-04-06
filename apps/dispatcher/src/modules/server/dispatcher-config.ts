import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface DispatcherConfig {
  authMode?: "legacy" | "token" | "open";
  apiToken?: string;
  port?: number;
}

const CONFIG_FILENAME = ".forgeflow-dispatcher.json";

function getConfigPath(): string {
  return path.join(os.homedir(), CONFIG_FILENAME);
}

export function loadDispatcherConfig(): DispatcherConfig {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return {};
  }
}

export function getDispatcherAuthMode(): string {
  const config = loadDispatcherConfig();
  return process.env.DISPATCHER_AUTH_MODE || config.authMode || "legacy";
}

export function getDispatcherApiToken(): string | null {
  const config = loadDispatcherConfig();
  return process.env.DISPATCHER_API_TOKEN || config.apiToken || null;
}
