export interface ConsoleConfig {
  dispatcherToken?: string;
  dispatcherUrl?: string;
}

export interface ConsoleConfigPathOptions {
  cwd?: string;
  homeDir?: string;
}

export const CONSOLE_CONFIG_FILENAME: string;

export function getConsoleConfigPath(options?: ConsoleConfigPathOptions): string;

export function secureConsoleConfigPermissions(options?: ConsoleConfigPathOptions): string;

export function loadConsoleConfigFile(options?: ConsoleConfigPathOptions): ConsoleConfig;

export function saveConsoleConfigFile(
  config: ConsoleConfig,
  options?: ConsoleConfigPathOptions,
): string;
