import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  createDefaultGeminiBetaConfig,
  readGeminiBetaConfig,
  resolveGeminiBetaConfigPaths,
} from "./config.js";

import type { GeminiBetaConfig, GeminiBetaDoctorCheck, GeminiBetaDoctorResult } from "./types.js";

function checkCommand(name: string, args: string[]) {
  const result = spawnSync(name, args, {
    encoding: "utf8",
  });
  const missingBinary = (result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
  const ok = !missingBinary;
  return {
    ok,
    message: ok ? `${name} is available` : `${name} is not available`,
    details: {
      stdout: (result.stdout || "").trim() || null,
      stderr: (result.stderr || "").trim() || null,
      status: result.status,
      error: result.error ? String(result.error.message || result.error) : null,
    },
  };
}

function checkPath(label: string, value: string) {
  const resolved = path.resolve(String(value || ""));
  const ok = Boolean(resolved) && fs.existsSync(resolved);
  return {
    ok,
    message: ok ? `${label} exists` : `${label} is missing`,
    details: {
      path: resolved,
    },
  };
}

function checkGitWorktree(label: string, value: string) {
  const resolved = path.resolve(String(value || ""));
  if (!resolved || !fs.existsSync(resolved)) {
    return {
      ok: false,
      message: `${label} is missing`,
      details: {
        path: resolved,
      },
    };
  }

  const result = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: resolved,
    encoding: "utf8",
  });
  const ok = (result.status ?? 1) === 0 && String(result.stdout || "").trim() === "true";
  return {
    ok,
    message: ok ? `${label} is a git worktree` : `${label} is not a git worktree`,
    details: {
      path: resolved,
      stdout: (result.stdout || "").trim() || null,
      stderr: (result.stderr || "").trim() || null,
      status: result.status,
      error: result.error ? String(result.error.message || result.error) : null,
    },
  };
}

function checkUrl(label: string, value: string) {
  try {
    const parsed = new URL(String(value || ""));
    return {
      ok: true,
      message: `${label} is valid`,
      details: { href: parsed.href },
    };
  } catch {
    return {
      ok: false,
      message: `${label} is invalid`,
      details: { value },
    };
  }
}

function majorNodeVersion() {
  const [major] = process.versions.node.split(".").map((item) => Number(item));
  return Number.isFinite(major) ? major : 0;
}

export function runGeminiBetaDoctor(options: {
  configPath?: string;
  cwd?: string;
  config?: Partial<GeminiBetaConfig>;
} = {}): GeminiBetaDoctorResult {
  const paths = resolveGeminiBetaConfigPaths({ configPath: options.configPath });
  const loaded = readGeminiBetaConfig({ configPath: paths.configPath });
  const config = createDefaultGeminiBetaConfig(
    {
      ...(loaded || {}),
      ...(options.config || {}),
    },
    { cwd: options.cwd },
  );
  const checks: GeminiBetaDoctorCheck[] = [];

  checks.push({
    name: "node",
    ok: majorNodeVersion() >= 22,
    message: majorNodeVersion() >= 22 ? `node ${process.versions.node}` : `node ${process.versions.node} is too old`,
  });

  const pnpmCheck = checkCommand("pnpm", ["--version"]);
  checks.push({
    name: "pnpm",
    ok: true,
    message: pnpmCheck.ok ? "pnpm is available (optional)" : "pnpm is not available (optional)",
    details: {
      optional: true,
      ...pnpmCheck.details,
    },
  });

  const gitCheck = checkCommand("git", ["--version"]);
  checks.push({ name: "git", ...gitCheck });

  checks.push({
    name: "config-file",
    ok: Boolean(loaded),
    message: loaded ? "config file exists" : "config file is missing",
    details: {
      configPath: paths.configPath,
    },
  });

  checks.push({
    name: "repo-dir",
    ...checkPath("repo dir", config.repoDir),
  });

  checks.push({
    name: "repo-git-worktree",
    ...checkGitWorktree("repo dir", config.repoDir),
  });

  checks.push({
    name: "dispatcher-url",
    ...checkUrl("dispatcher url", config.dispatcherUrl),
  });

  checks.push({
    name: "gemini-bin",
    ...checkCommand(config.geminiBin, ["--version"]),
  });

  checks.push({
    name: "worker-id",
    ok: String(config.workerId || "").trim().length > 0,
    message: String(config.workerId || "").trim().length > 0 ? "worker id is set" : "worker id is missing",
  });

  checks.push({
    name: "pool",
    ok: config.pool === "gemini",
    message: config.pool === "gemini" ? "pool is gemini" : "pool must be gemini",
  });

  return {
    ok: checks.every((item) => item.ok),
    configPath: paths.configPath,
    config,
    checks,
  };
}

export function formatGeminiBetaDoctorResult(result: GeminiBetaDoctorResult): string {
  const lines = [
    `configPath: ${result.configPath}`,
    `ok: ${result.ok ? "yes" : "no"}`,
  ];

  for (const check of result.checks) {
    lines.push(`- ${check.name}: ${check.ok ? "ok" : "fail"}${check.message ? ` (${check.message})` : ""}`);
  }

  return lines.join("\n");
}
