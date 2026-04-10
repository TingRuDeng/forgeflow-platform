import fs from "node:fs";
import path from "node:path";

import type { DispatcherRuntimeConfig } from "./config.ts";
import { getConfigPath } from "./config.ts";
import { getJson } from "./http.ts";

function canWriteDirectory(dir: string) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, ".forgeflow-dispatcher-write-probe");
    fs.writeFileSync(probe, "ok\n");
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

export async function getStatus(config: DispatcherRuntimeConfig) {
  const baseUrl = `http://${config.host}:${config.port}`;
  try {
    const result = await getJson(`${baseUrl}/health`);
    return {
      configured: true,
      reachable: true,
      baseUrl,
      health: result,
    };
  } catch (error) {
    return {
      configured: true,
      reachable: false,
      baseUrl,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runDoctor(config: DispatcherRuntimeConfig) {
  const configPath = getConfigPath();
  const checks = {
    configPath,
    configExists: fs.existsSync(configPath),
    stateDir: config.stateDir,
    stateDirWritable: canWriteDirectory(config.stateDir),
    authMode: config.authMode,
    tokenConfigured: typeof config.apiToken === "string" && config.apiToken.length > 0,
    status: await getStatus(config),
  };

  const problems: string[] = [];
  if (!checks.stateDirWritable) {
    problems.push(`state dir is not writable: ${config.stateDir}`);
  }
  if (config.authMode === "token" && !checks.tokenConfigured) {
    problems.push("auth mode is token but no apiToken is configured");
  }

  return {
    ok: problems.length === 0,
    problems,
    checks,
  };
}
