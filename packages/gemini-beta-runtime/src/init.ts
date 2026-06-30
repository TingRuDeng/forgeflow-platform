import {
  createDefaultGeminiBetaConfig,
  normalizeGeminiBetaConfig,
  readGeminiBetaConfig,
  resolveGeminiBetaConfigPaths,
  writeGeminiBetaConfig,
} from "./config.js";

import type { GeminiBetaConfig, GeminiBetaInitOptions } from "./types.js";

export interface GeminiBetaInitResult {
  created: boolean;
  configPath: string;
  config: GeminiBetaConfig;
}

export function initGeminiBetaConfig(options: GeminiBetaInitOptions = {}): GeminiBetaInitResult {
  const paths = resolveGeminiBetaConfigPaths(options);
  const existing = readGeminiBetaConfig({ configPath: paths.configPath });

  if (existing && !options.overwrite) {
    return {
      created: false,
      configPath: paths.configPath,
      config: existing,
    };
  }

  const config = normalizeGeminiBetaConfig(
    existing
      ? {
          ...existing,
          repoDir: options.repoDir ?? existing.repoDir,
          dispatcherUrl: options.dispatcherUrl ?? existing.dispatcherUrl,
          workerId: options.workerId ?? existing.workerId,
          pollIntervalMs: options.pollIntervalMs ?? existing.pollIntervalMs,
          geminiBin: options.geminiBin ?? existing.geminiBin,
          pool: options.pool ?? existing.pool,
        }
      : createDefaultGeminiBetaConfig(options, { cwd: options.cwd }),
    { cwd: options.cwd },
  );

  writeGeminiBetaConfig(config, { configPath: paths.configPath });

  return {
    created: true,
    configPath: paths.configPath,
    config,
  };
}
