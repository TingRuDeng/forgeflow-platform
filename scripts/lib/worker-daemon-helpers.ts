import { spawnSync } from "node:child_process";

function ensureSuccess(
  result: { status: number | null; stdout: string; stderr: string },
  message: string,
): void {
  if ((result.status ?? 1) !== 0) {
    throw new Error(result.stderr || result.stdout || message);
  }
}

function runGit(args: string[], cwd: string) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
  });
  return {
    status: result.status ?? 1,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
  };
}

function resolveAllowlist(envSource: NodeJS.ProcessEnv): string[] {
  const defaultAllowlist = [
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
    "FORGEFLOW_CODEX_MODEL",
    "FORGEFLOW_EXEC_TIMEOUT_MS",
    "FORGEFLOW_VERIFICATION_TIMEOUT_MS",
    "FORGEFLOW_VERIFICATION_SHELL",
    "FORGEFLOW_GIT_SSH_COMMAND",
  ];

  return String(envSource.FORGEFLOW_WORKER_ENV_ALLOWLIST || defaultAllowlist.join(","))
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildWorkerEnv(envSource: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of resolveAllowlist(envSource)) {
    if (envSource[key] !== undefined) {
      env[key] = envSource[key];
    }
  }
  return env;
}

export function assertSafeBranchName(
  repoDir: string,
  branchName: string,
  defaultBranch: string,
  envSource: NodeJS.ProcessEnv = process.env,
): void {
  const normalizedBranch = branchName.trim();
  if (!normalizedBranch) {
    throw new Error("invalid branchName (empty)");
  }
  if (normalizedBranch !== branchName) {
    throw new Error("invalid branchName (surrounding whitespace)");
  }
  if (normalizedBranch === defaultBranch) {
    throw new Error(`refusing to push to default branch: ${defaultBranch}`);
  }

  const allowedPrefixes = String(envSource.FORGEFLOW_ALLOWED_PUSH_PREFIXES || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (allowedPrefixes.length > 0 && !allowedPrefixes.some((prefix) => normalizedBranch.startsWith(prefix))) {
    throw new Error(`branchName not allowed by FORGEFLOW_ALLOWED_PUSH_PREFIXES: ${normalizedBranch}`);
  }

  ensureSuccess(
    runGit(["check-ref-format", "--branch", normalizedBranch], repoDir),
    `invalid git branch ref: ${normalizedBranch}`,
  );
}

export function shouldCreatePullRequest(envSource: NodeJS.ProcessEnv = process.env): boolean {
  return envSource.FORGEFLOW_WORKER_CREATE_PR === "1";
}

export function shouldRemoveWorktreeOnExit(envSource: NodeJS.ProcessEnv = process.env): boolean {
  return envSource.FORGEFLOW_WORKER_REMOVE_WORKTREE_ON_EXIT === "1";
}
