import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface CliConfig {
  dispatcherToken?: string;
  dispatcherUrl?: string;
}

const CONFIG_FILENAME = ".forgeflow-review-orchestrator.json";

function getConfigPath(): string {
  return path.join(os.homedir(), CONFIG_FILENAME);
}

export function loadConfig(): CliConfig {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return {};
  }
  try {
    const content = fs.readFileSync(configPath, "utf8");
    return JSON.parse(content);
  } catch {
    return {};
  }
}

export function saveConfig(config: CliConfig): void {
  const configPath = getConfigPath();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

export function getDispatcherToken(): string | undefined {
  return process.env.DISPATCHER_API_TOKEN || loadConfig().dispatcherToken;
}
