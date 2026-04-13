export interface CodexBetaConfig {
  version: 1;
  repoDir: string;
  dispatcherUrl: string;
  workerId: string;
  pollIntervalMs: number;
  codexBin: string;
  pool: "codex";
}

export interface CodexBetaConfigInput {
  repoDir?: string;
  dispatcherUrl?: string;
  workerId?: string;
  pollIntervalMs?: number;
  codexBin?: string;
  pool?: "codex";
}

export interface CodexBetaInitOptions extends CodexBetaConfigInput {
  configPath?: string;
  cwd?: string;
  overwrite?: boolean;
}

export interface CodexBetaConfigLoadOptions {
  configPath?: string;
}

export interface CodexBetaConfigPaths {
  homeDir: string;
  configDir: string;
  configPath: string;
}

export interface CodexBetaDoctorCheck {
  name: string;
  ok: boolean;
  message: string;
  details?: Record<string, unknown>;
}

export interface CodexBetaDoctorResult {
  ok: boolean;
  configPath: string;
  config: CodexBetaConfig;
  checks: CodexBetaDoctorCheck[];
}
