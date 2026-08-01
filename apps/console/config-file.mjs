import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  readSecureConfigFile,
  repairSecureConfigFilePermissions,
  writeSecureConfigFile,
} from "@tingrudeng/beta-runtime-core/runtime/secure-config-file.js";
import { normalizeOptionalDispatcherToken } from "@tingrudeng/beta-runtime-core/runtime/dispatcher-auth.js";

export const CONSOLE_CONFIG_FILENAME = ".forgeflow-console.json";

const CONFIG_POLICY = {
  label: "console config",
};

function normalizeConsoleConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return {
    ...value,
    dispatcherToken: normalizeOptionalDispatcherToken(
      value.dispatcherToken,
      "console config dispatcherToken",
    ),
  };
}

export function getConsoleConfigPath(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const homeDir = path.resolve(options.homeDir || os.homedir());
  const projectConfig = path.join(cwd, CONSOLE_CONFIG_FILENAME);
  if (fs.lstatSync(projectConfig, { throwIfNoEntry: false })) {
    return projectConfig;
  }
  return path.join(homeDir, CONSOLE_CONFIG_FILENAME);
}

export function secureConsoleConfigPermissions(options = {}) {
  const configPath = getConsoleConfigPath(options);
  repairSecureConfigFilePermissions(configPath, CONFIG_POLICY);
  return configPath;
}

export function loadConsoleConfigFile(options = {}) {
  const configPath = getConsoleConfigPath(options);
  const content = readSecureConfigFile(configPath, CONFIG_POLICY);
  if (content === null) {
    return {};
  }
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return {};
  }
  return normalizeConsoleConfig(parsed);
}

export function saveConsoleConfigFile(config, options = {}) {
  const configPath = getConsoleConfigPath(options);
  writeSecureConfigFile(
    configPath,
    JSON.stringify(normalizeConsoleConfig(config), null, 2),
    CONFIG_POLICY,
  );
  return configPath;
}
