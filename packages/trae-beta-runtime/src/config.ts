import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  TraeBetaConfig,
  TraeBetaConfigInput,
  TraeBetaConfigLoadOptions,
  TraeBetaConfigPaths,
} from "./types.js";

export const TRAE_BETA_CONFIG_VERSION = 2 as const;
export const DEFAULT_TRAE_BETA_CONFIG_DIR_NAME = ".forgeflow-trae-beta";
export const DEFAULT_TRAE_BETA_CONFIG_FILE_NAME = "config.json";

function normalizeDirectory(value: string) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }
  return path.resolve(trimmed);
}

function normalizeUrl(value: string, fallback: string) {
  const trimmed = String(value || "").trim();
  return trimmed || fallback;
}

function normalizeWorkerId(value: string, projectPath: string) {
  const trimmed = String(value || "").trim();
  if (trimmed) {
    return trimmed;
  }

  const basename = path.basename(projectPath || "").trim();
  return basename ? `trae-${basename}` : "trae-remote";
}

export function resolveTraeBetaConfigPaths(
  options: TraeBetaConfigLoadOptions = {},
): TraeBetaConfigPaths {
  const homeDir = path.resolve(os.homedir());
  const configDir = options.configPath
    ? path.dirname(path.resolve(options.configPath))
    : path.join(homeDir, DEFAULT_TRAE_BETA_CONFIG_DIR_NAME);
  const configPath = options.configPath
    ? path.resolve(options.configPath)
    : path.join(configDir, DEFAULT_TRAE_BETA_CONFIG_FILE_NAME);

  return {
    homeDir,
    configDir,
    configPath,
  };
}

export function createDefaultTraeBetaConfig(
  input: TraeBetaConfigInput = {},
  options: { cwd?: string } = {},
): TraeBetaConfig {
  const cwd = normalizeDirectory(options.cwd || process.cwd());
  const projectPath = normalizeDirectory(input.projectPath || cwd);

  return {
    version: TRAE_BETA_CONFIG_VERSION,
    projectPath,
    dispatcherUrl: normalizeUrl(input.dispatcherUrl || "", "http://127.0.0.1:8787"),
    dispatcherToken: input.dispatcherToken,
    automationUrl: normalizeUrl(input.automationUrl || "", "http://127.0.0.1:8790"),
    workerId: normalizeWorkerId(input.workerId || "", projectPath),
    traeBin: normalizeDirectory(input.traeBin || "/Applications/Trae CN.app"),
    remoteDebuggingPort: Number(input.remoteDebuggingPort || 9222),
  };
}

export function normalizeTraeBetaConfig(
  input: Partial<TraeBetaConfig> = {},
  options: { cwd?: string } = {},
): TraeBetaConfig {
  return createDefaultTraeBetaConfig(
    {
      projectPath: input.projectPath,
      dispatcherUrl: input.dispatcherUrl,
      dispatcherToken: input.dispatcherToken,
      automationUrl: input.automationUrl,
      workerId: input.workerId,
      traeBin: input.traeBin,
      remoteDebuggingPort: input.remoteDebuggingPort,
    },
    options,
  );
}

export function readTraeBetaConfig(
  options: TraeBetaConfigLoadOptions = {},
): TraeBetaConfig | null {
  const { configPath } = resolveTraeBetaConfigPaths(options);
  if (!fs.existsSync(configPath)) {
    return null;
  }

  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = JSON.parse(raw) as Partial<TraeBetaConfig>;
  return normalizeTraeBetaConfig(parsed, { cwd: path.dirname(configPath) });
}

export function writeTraeBetaConfig(
  config: TraeBetaConfig,
  options: TraeBetaConfigLoadOptions = {},
): TraeBetaConfigPaths {
  const paths = resolveTraeBetaConfigPaths(options);
  fs.mkdirSync(paths.configDir, { recursive: true });
  fs.writeFileSync(paths.configPath, `${JSON.stringify(config, null, 2)}\n`);
  return paths;
}

export function readDispatcherTokenFromConfig(): string | undefined {
  const config = readTraeBetaConfig();
  return config?.dispatcherToken;
}
