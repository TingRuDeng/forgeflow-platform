const REQUIRED_EXECUTION_POLICY_ENV_KEYS = [
  "FORGEFLOW_EXECUTION_PROFILE",
  "FORGEFLOW_EXECUTION_CONTAINER_RUNTIME",
  "FORGEFLOW_EXECUTION_CONTAINER_IMAGE",
  "FORGEFLOW_EXECUTION_NETWORK",
  "FORGEFLOW_EXECUTION_CPUS",
  "FORGEFLOW_EXECUTION_MEMORY",
  "FORGEFLOW_EXECUTION_PIDS_LIMIT",
  "FORGEFLOW_EXECUTION_CONTAINER_USER",
];

const DEFAULT_WORKER_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "TERM",
  "TMPDIR",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "FORGEFLOW_CODEX_BIN",
  "FORGEFLOW_CODEX_MODEL",
  "FORGEFLOW_CODEX_SANDBOX",
  "FORGEFLOW_CODEX_ARGS_JSON",
  "FORGEFLOW_CODEX_ARGS",
  "FORGEFLOW_GEMINI_BIN",
  "FORGEFLOW_GEMINI_MODEL",
  "FORGEFLOW_GEMINI_ARGS_JSON",
  "FORGEFLOW_GEMINI_ARGS",
  ...REQUIRED_EXECUTION_POLICY_ENV_KEYS,
  "FORGEFLOW_EXEC_TIMEOUT_MS",
  "FORGEFLOW_VERIFICATION_TIMEOUT_MS",
  "FORGEFLOW_VERIFICATION_SHELL",
  "FORGEFLOW_GIT_SSH_COMMAND",
];

const PROVIDER_SECRET_KEYS = [
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
] as const;

function providerSecretKey(provider?: string): typeof PROVIDER_SECRET_KEYS[number] | null {
  if (provider === "codex") {
    return "OPENAI_API_KEY";
  }
  if (provider === "gemini") {
    return "GEMINI_API_KEY";
  }
  return null;
}

function resolveWorkerEnvAllowlist(envSource: NodeJS.ProcessEnv): string[] {
  return String(envSource.FORGEFLOW_WORKER_ENV_ALLOWLIST || DEFAULT_WORKER_ENV_ALLOWLIST.join(","))
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildProviderProcessEnv(
  envSource: NodeJS.ProcessEnv = process.env,
  provider?: string,
): NodeJS.ProcessEnv {
  const env = { ...envSource };
  const allowedSecret = providerSecretKey(provider);
  for (const key of PROVIDER_SECRET_KEYS) {
    if (key !== allowedSecret) {
      delete env[key];
    }
  }
  return env;
}

export function buildWorkerEnv(
  envSource: NodeJS.ProcessEnv = process.env,
  provider?: string,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  // 只传递任务执行必需变量，避免控制面 token 暴露给 assignment 和模型进程。
  const allowedKeys = new Set([
    ...resolveWorkerEnvAllowlist(envSource),
    ...REQUIRED_EXECUTION_POLICY_ENV_KEYS,
  ]);
  const allowedSecret = providerSecretKey(provider);
  for (const key of allowedKeys) {
    if (
      PROVIDER_SECRET_KEYS.includes(key as typeof PROVIDER_SECRET_KEYS[number])
      && key !== allowedSecret
    ) {
      continue;
    }
    if (envSource[key] !== undefined) {
      env[key] = envSource[key];
    }
  }
  return env;
}
