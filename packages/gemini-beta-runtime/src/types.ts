export interface GeminiBetaConfig {
  version: 1;
  repoDir: string;
  dispatcherUrl: string;
  workerId: string;
  pollIntervalMs: number;
  geminiBin: string;
  pool: "gemini";
}

export interface GeminiBetaConfigInput {
  repoDir?: string;
  dispatcherUrl?: string;
  workerId?: string;
  pollIntervalMs?: number;
  geminiBin?: string;
  pool?: "gemini";
}

export interface GeminiBetaInitOptions extends GeminiBetaConfigInput {
  configPath?: string;
  cwd?: string;
  overwrite?: boolean;
}

export interface GeminiBetaConfigLoadOptions {
  configPath?: string;
}

export interface GeminiBetaConfigPaths {
  homeDir: string;
  configDir: string;
  configPath: string;
}

export interface GeminiBetaDoctorCheck {
  name: string;
  ok: boolean;
  message: string;
  details?: Record<string, unknown>;
}

export interface GeminiBetaDoctorResult {
  ok: boolean;
  configPath: string;
  config: GeminiBetaConfig;
  checks: GeminiBetaDoctorCheck[];
}
