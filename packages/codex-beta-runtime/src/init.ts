import {
  createDefaultCodexBetaConfig,
  normalizeCodexBetaConfig,
  readCodexBetaConfig,
  resolveCodexBetaConfigPaths,
  writeCodexBetaConfig,
} from "./config.js";

import type { CodexBetaConfig, CodexBetaInitOptions } from "./types.js";

export interface CodexBetaInitResult {
  created: boolean;
  configPath: string;
  config: CodexBetaConfig;
}

export function initCodexBetaConfig(options: CodexBetaInitOptions = {}): CodexBetaInitResult {
  const paths = resolveCodexBetaConfigPaths(options);
  const existing = readCodexBetaConfig({ configPath: paths.configPath });

  if (existing && !options.overwrite) {
    return {
      created: false,
      configPath: paths.configPath,
      config: existing,
    };
  }

  const config = normalizeCodexBetaConfig(
    existing
      ? {
          ...existing,
          repoDir: options.repoDir ?? existing.repoDir,
          dispatcherUrl: options.dispatcherUrl ?? existing.dispatcherUrl,
          workerId: options.workerId ?? existing.workerId,
          pollIntervalMs: options.pollIntervalMs ?? existing.pollIntervalMs,
          codexBin: options.codexBin ?? existing.codexBin,
          pool: options.pool ?? existing.pool,
        }
      : createDefaultCodexBetaConfig(options, { cwd: options.cwd }),
    { cwd: options.cwd },
  );

  writeCodexBetaConfig(config, { configPath: paths.configPath });

  return {
    created: true,
    configPath: paths.configPath,
    config,
  };
}
