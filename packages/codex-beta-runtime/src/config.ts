import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  CodexBetaConfig,
  CodexBetaConfigInput,
  CodexBetaConfigLoadOptions,
  CodexBetaConfigPaths,
} from "./types.js";

export const CODEX_BETA_CONFIG_VERSION = 1 as const;
export const DEFAULT_CODEX_BETA_CONFIG_DIR_NAME = ".forgeflow-codex-beta";
export const DEFAULT_CODEX_BETA_CONFIG_FILE_NAME = "config.json";

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
  return basename ? `codex-${basename}` : "codex-remote";
}

function normalizePollInterval(value: unknown) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.floor(numeric);
  }
  return 5000;
}

function normalizeCodexBin(value: string) {
  const trimmed = String(value || "").trim();
  return trimmed || "codex";
}

export function resolveCodexBetaConfigPaths(
  options: CodexBetaConfigLoadOptions = {},
): CodexBetaConfigPaths {
  const homeDir = path.resolve(os.homedir());
  const configDir = options.configPath
    ? path.dirname(path.resolve(options.configPath))
    : path.join(homeDir, DEFAULT_CODEX_BETA_CONFIG_DIR_NAME);
  const configPath = options.configPath
    ? path.resolve(options.configPath)
    : path.join(configDir, DEFAULT_CODEX_BETA_CONFIG_FILE_NAME);

  return {
    homeDir,
    configDir,
    configPath,
  };
}

export function createDefaultCodexBetaConfig(
  input: CodexBetaConfigInput = {},
  options: { cwd?: string } = {},
): CodexBetaConfig {
  const cwd = normalizeDirectory(options.cwd || process.cwd());
  const repoDir = normalizeDirectory(input.repoDir || cwd);

  return {
    version: CODEX_BETA_CONFIG_VERSION,
    repoDir,
    dispatcherUrl: normalizeUrl(input.dispatcherUrl || "", "http://127.0.0.1:8787"),
    workerId: normalizeWorkerId(input.workerId || "", repoDir),
    pollIntervalMs: normalizePollInterval(input.pollIntervalMs),
    codexBin: normalizeCodexBin(input.codexBin || ""),
    pool: "codex",
  };
}

export function normalizeCodexBetaConfig(
  input: Partial<CodexBetaConfig> = {},
  options: { cwd?: string } = {},
): CodexBetaConfig {
  return createDefaultCodexBetaConfig(
    {
      repoDir: input.repoDir,
      dispatcherUrl: input.dispatcherUrl,
      workerId: input.workerId,
      pollIntervalMs: input.pollIntervalMs,
      codexBin: input.codexBin,
      pool: input.pool,
    },
    options,
  );
}

export function readCodexBetaConfig(
  options: CodexBetaConfigLoadOptions = {},
): CodexBetaConfig | null {
  const { configPath } = resolveCodexBetaConfigPaths(options);
  if (!fs.existsSync(configPath)) {
    return null;
  }

  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = JSON.parse(raw) as Partial<CodexBetaConfig>;
  return normalizeCodexBetaConfig(parsed, { cwd: path.dirname(configPath) });
}

export function writeCodexBetaConfig(
  config: CodexBetaConfig,
  options: CodexBetaConfigLoadOptions = {},
): CodexBetaConfigPaths {
  const paths = resolveCodexBetaConfigPaths(options);
  fs.mkdirSync(paths.configDir, { recursive: true });
  fs.writeFileSync(paths.configPath, `${JSON.stringify(config, null, 2)}\n`);
  return paths;
}
