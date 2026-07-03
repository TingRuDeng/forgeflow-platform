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
  "FORGEFLOW_EXEC_TIMEOUT_MS",
  "FORGEFLOW_VERIFICATION_TIMEOUT_MS",
  "FORGEFLOW_VERIFICATION_SHELL",
  "FORGEFLOW_GIT_SSH_COMMAND",
];

function resolveWorkerEnvAllowlist(envSource: NodeJS.ProcessEnv): string[] {
  return String(envSource.FORGEFLOW_WORKER_ENV_ALLOWLIST || DEFAULT_WORKER_ENV_ALLOWLIST.join(","))
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildWorkerEnv(envSource: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  // 只传递任务执行必需变量，避免控制面 token 暴露给 assignment 和模型进程。
  for (const key of resolveWorkerEnvAllowlist(envSource)) {
    if (envSource[key] !== undefined) {
      env[key] = envSource[key];
    }
  }
  return env;
}
