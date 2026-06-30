import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  GeminiBetaConfig,
  GeminiBetaConfigInput,
  GeminiBetaConfigLoadOptions,
  GeminiBetaConfigPaths,
} from "./types.js";

export const GEMINI_BETA_CONFIG_VERSION = 1 as const;
export const DEFAULT_GEMINI_BETA_CONFIG_DIR_NAME = ".forgeflow-gemini-beta";
export const DEFAULT_GEMINI_BETA_CONFIG_FILE_NAME = "config.json";

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

function normalizeWorkerId(value: string, repoDir: string) {
  const trimmed = String(value || "").trim();
  if (trimmed) {
    return trimmed;
  }

  const basename = path.basename(repoDir || "").trim();
  return basename ? `gemini-${basename}` : "gemini-remote";
}

function normalizePollInterval(value: unknown) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.floor(numeric);
  }
  return 5000;
}

function normalizeGeminiBin(value: string) {
  const trimmed = String(value || "").trim();
  return trimmed || "gemini";
}

export function resolveGeminiBetaConfigPaths(
  options: GeminiBetaConfigLoadOptions = {},
): GeminiBetaConfigPaths {
  const homeDir = path.resolve(os.homedir());
  const configDir = options.configPath
    ? path.dirname(path.resolve(options.configPath))
    : path.join(homeDir, DEFAULT_GEMINI_BETA_CONFIG_DIR_NAME);
  const configPath = options.configPath
    ? path.resolve(options.configPath)
    : path.join(configDir, DEFAULT_GEMINI_BETA_CONFIG_FILE_NAME);

  return {
    homeDir,
    configDir,
    configPath,
  };
}

export function createDefaultGeminiBetaConfig(
  input: GeminiBetaConfigInput = {},
  options: { cwd?: string } = {},
): GeminiBetaConfig {
  const cwd = normalizeDirectory(options.cwd || process.cwd());
  const repoDir = normalizeDirectory(input.repoDir || cwd);

  return {
    version: GEMINI_BETA_CONFIG_VERSION,
    repoDir,
    dispatcherUrl: normalizeUrl(input.dispatcherUrl || "", "http://127.0.0.1:8787"),
    workerId: normalizeWorkerId(input.workerId || "", repoDir),
    pollIntervalMs: normalizePollInterval(input.pollIntervalMs),
    geminiBin: normalizeGeminiBin(input.geminiBin || ""),
    pool: "gemini",
  };
}

export function normalizeGeminiBetaConfig(
  input: Partial<GeminiBetaConfig> = {},
  options: { cwd?: string } = {},
): GeminiBetaConfig {
  return createDefaultGeminiBetaConfig(
    {
      repoDir: input.repoDir,
      dispatcherUrl: input.dispatcherUrl,
      workerId: input.workerId,
      pollIntervalMs: input.pollIntervalMs,
      geminiBin: input.geminiBin,
      pool: input.pool,
    },
    options,
  );
}

export function readGeminiBetaConfig(
  options: GeminiBetaConfigLoadOptions = {},
): GeminiBetaConfig | null {
  const { configPath } = resolveGeminiBetaConfigPaths(options);
  if (!fs.existsSync(configPath)) {
    return null;
  }

  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = JSON.parse(raw) as Partial<GeminiBetaConfig>;
  return normalizeGeminiBetaConfig(parsed, { cwd: path.dirname(configPath) });
}

export function writeGeminiBetaConfig(
  config: GeminiBetaConfig,
  options: GeminiBetaConfigLoadOptions = {},
): GeminiBetaConfigPaths {
  const paths = resolveGeminiBetaConfigPaths(options);
  fs.mkdirSync(paths.configDir, { recursive: true });
  fs.writeFileSync(paths.configPath, `${JSON.stringify(config, null, 2)}\n`);
  return paths;
}
