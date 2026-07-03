import { spawnSync } from "node:child_process";

export interface GitResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export function ensureSuccess(result: GitResult, message: string): void {
  if ((result.status ?? 1) !== 0) {
    throw new Error(result.stderr || result.stdout || message);
  }
}

export function runGit(args: string[], cwd: string): GitResult {
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
