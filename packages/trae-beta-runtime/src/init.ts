import fs from "node:fs";

import {
  createDefaultTraeBetaConfig,
  normalizeTraeBetaConfig,
  readTraeBetaConfig,
  resolveTraeBetaConfigPaths,
  writeTraeBetaConfig,
} from "./config.js";

import type { TraeBetaConfig, TraeBetaInitOptions } from "./types.js";

export interface TraeBetaInitResult {
  created: boolean;
  configPath: string;
  config: TraeBetaConfig;
}

export function initTraeBetaConfig(options: TraeBetaInitOptions = {}): TraeBetaInitResult {
  const paths = resolveTraeBetaConfigPaths(options);
  const existing = readTraeBetaConfig({ configPath: paths.configPath });

  if (existing && !options.overwrite) {
    return {
      created: false,
      configPath: paths.configPath,
      config: existing,
    };
  }

  const config = normalizeTraeBetaConfig(
    existing
      ? {
          ...existing,
          projectPath: options.projectPath ?? existing.projectPath,
          dispatcherUrl: options.dispatcherUrl ?? existing.dispatcherUrl,
          automationUrl: options.automationUrl ?? existing.automationUrl,
          workerId: options.workerId ?? existing.workerId,
          traeBin: options.traeBin ?? existing.traeBin,
          remoteDebuggingPort: options.remoteDebuggingPort ?? existing.remoteDebuggingPort,
        }
      : createDefaultTraeBetaConfig(options, { cwd: options.cwd }),
    { cwd: options.cwd },
  );

  writeTraeBetaConfig(config, { configPath: paths.configPath });

  return {
    created: true,
    configPath: paths.configPath,
    config,
  };
}

export function hasTraeBetaConfig(configPath: string): boolean {
  return fs.existsSync(configPath);
}
