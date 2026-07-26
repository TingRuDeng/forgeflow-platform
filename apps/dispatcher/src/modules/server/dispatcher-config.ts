import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface DispatcherConfig {
  authMode?: "legacy" | "token" | "open";
  apiToken?: string;
  workerTokens?: Record<string, string>;
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

export function getDispatcherWorkerTokens(): Record<string, string> {
  const config = loadDispatcherConfig();
  const raw = process.env.DISPATCHER_WORKER_TOKENS;
  const apiToken = process.env.DISPATCHER_API_TOKEN || config.apiToken || null;
  let candidate: unknown = config.workerTokens ?? {};

  if (raw) {
    try {
      candidate = JSON.parse(raw);
    } catch (error) {
      throw new Error(
        `failed to parse DISPATCHER_WORKER_TOKENS: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("DISPATCHER_WORKER_TOKENS must be a JSON object mapping worker IDs to tokens");
  }

  const workerTokens: Record<string, string> = {};
  const seenTokens = new Set<string>();
  for (const [workerId, token] of Object.entries(candidate)) {
    if (!workerId.trim() || workerId !== workerId.trim()) {
      throw new Error("DISPATCHER_WORKER_TOKENS contains an invalid worker ID");
    }
    if (typeof token !== "string" || !token.trim() || token !== token.trim()) {
      throw new Error(`DISPATCHER_WORKER_TOKENS contains an invalid token for worker "${workerId}"`);
    }
    if (apiToken && token === apiToken) {
      throw new Error(`DISPATCHER_WORKER_TOKENS token for worker "${workerId}" must differ from DISPATCHER_API_TOKEN`);
    }
    if (seenTokens.has(token)) {
      throw new Error("DISPATCHER_WORKER_TOKENS must use a unique token for each worker");
    }
    seenTokens.add(token);
    workerTokens[workerId] = token;
  }
  return workerTokens;
}
