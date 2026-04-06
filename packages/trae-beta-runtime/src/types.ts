export interface TraeBetaConfig {
  version: 2;
  projectPath: string;
  dispatcherUrl: string;
  dispatcherToken?: string;
  automationUrl: string;
  workerId: string;
  traeBin: string;
  remoteDebuggingPort: number;
}

export interface TraeBetaConfigInput {
  projectPath?: string;
  dispatcherUrl?: string;
  dispatcherToken?: string;
  automationUrl?: string;
  workerId?: string;
  traeBin?: string;
  remoteDebuggingPort?: number;
}

export interface TraeBetaInitOptions extends TraeBetaConfigInput {
  configPath?: string;
  cwd?: string;
  overwrite?: boolean;
}

export interface TraeBetaConfigLoadOptions {
  configPath?: string;
  cwd?: string;
}

export interface TraeBetaConfigPaths {
  homeDir: string;
  configDir: string;
  configPath: string;
}

export interface TraeBetaDoctorCheck {
  name: string;
  ok: boolean;
  message: string;
  details?: Record<string, unknown>;
}

export interface TraeBetaDoctorResult {
  ok: boolean;
  configPath: string;
  config: TraeBetaConfig;
  checks: TraeBetaDoctorCheck[];
}
