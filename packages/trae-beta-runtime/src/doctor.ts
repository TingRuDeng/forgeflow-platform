import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  createDefaultTraeBetaConfig,
  readTraeBetaConfig,
  resolveTraeBetaConfigPaths,
} from "./config.js";

import type { TraeBetaConfig, TraeBetaDoctorCheck, TraeBetaDoctorResult } from "./types.js";

function checkCommand(name: string, args: string[]) {
  const result = spawnSync(name, args, {
    encoding: "utf8",
  });
  const ok = (result.status ?? 1) === 0;
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

function resolveTraeExecutablePath(config: TraeBetaConfig) {
  const root = path.resolve(config.traeBin);
  if (root.endsWith(".app")) {
    return path.join(root, "Contents", "MacOS", "Electron");
  }
  return root;
}

function checkTraeBinary(config: TraeBetaConfig) {
  const executablePath = resolveTraeExecutablePath(config);
  const ok = fs.existsSync(executablePath);
  return {
    ok,
    message: ok ? "Trae binary exists" : "Trae binary is missing",
    details: {
      appBundle: path.resolve(config.traeBin),
      executablePath,
    },
  };
}

function majorNodeVersion() {
  const [major] = process.versions.node.split(".").map((item) => Number(item));
  return Number.isFinite(major) ? major : 0;
}

export function runTraeBetaDoctor(options: {
  configPath?: string;
  cwd?: string;
  config?: Partial<TraeBetaConfig>;
} = {}): TraeBetaDoctorResult {
  const paths = resolveTraeBetaConfigPaths({ configPath: options.configPath });
  const loaded = readTraeBetaConfig({ configPath: paths.configPath });
  const config = createDefaultTraeBetaConfig(
    {
      ...(loaded || {}),
      ...(options.config || {}),
    },
    { cwd: options.cwd },
  );
  const checks: TraeBetaDoctorCheck[] = [];

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
    name: "project-path",
    ...checkPath("project path", config.projectPath),
  });

  checks.push({
    name: "project-git-repo",
    ...checkGitWorktree("project path", config.projectPath),
  });

  checks.push({
    name: "trae-bin",
    ...checkTraeBinary(config),
  });

  checks.push({
    name: "dispatcher-url",
    ...checkUrl("dispatcher url", config.dispatcherUrl),
  });

  checks.push({
    name: "automation-url",
    ...checkUrl("automation url", config.automationUrl),
  });

  checks.push({
    name: "worker-id",
    ok: String(config.workerId || "").trim().length > 0,
    message: String(config.workerId || "").trim().length > 0 ? "worker id is set" : "worker id is missing",
  });

  return {
    ok: checks.every((item) => item.ok),
    configPath: paths.configPath,
    config,
    checks,
  };
}

export function formatTraeBetaDoctorResult(result: TraeBetaDoctorResult): string {
  const lines = [
    `configPath: ${result.configPath}`,
    `ok: ${result.ok ? "yes" : "no"}`,
  ];

  for (const check of result.checks) {
    lines.push(`- ${check.name}: ${check.ok ? "ok" : "fail"}${check.message ? ` (${check.message})` : ""}`);
  }

  return lines.join("\n");
}
