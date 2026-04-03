import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  createDefaultTraeBetaConfig,
  readTraeBetaConfig,
  resolveTraeBetaConfigPaths,
} from "./config.js";

import type { TraeBetaConfig, TraeBetaDoctorCheck, TraeBetaDoctorResult } from "./types.js";

interface HttpProbeResult {
  ok: boolean;
  statusCode: number | null;
  body: unknown;
  error: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isOptionalCheck(check: TraeBetaDoctorCheck): boolean {
  return check.details?.optional === true;
}

function buildUrlWithPath(baseUrl: string, pathname: string): string {
  const normalizedBase = String(baseUrl || "").endsWith("/")
    ? String(baseUrl)
    : `${String(baseUrl || "")}/`;
  return new URL(pathname, normalizedBase).toString();
}

function runHttpProbe(url: string, timeoutMs = 2_000): HttpProbeResult {
  const probeScript = `
const target = process.argv[1];
const timeoutMs = Number(process.argv[2] || 2000);
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), timeoutMs);

(async () => {
  try {
    const response = await fetch(target, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    process.stdout.write(JSON.stringify({
      ok: true,
      statusCode: response.status,
      body: parsed,
      error: null,
    }));
  } catch (error) {
    process.stdout.write(JSON.stringify({
      ok: false,
      statusCode: null,
      body: null,
      error: error instanceof Error ? error.message : String(error),
    }));
  } finally {
    clearTimeout(timer);
  }
})();
`;

  const result = spawnSync(process.execPath, ["-e", probeScript, url, String(timeoutMs)], {
    encoding: "utf8",
  });

  if ((result.status ?? 1) !== 0) {
    return {
      ok: false,
      statusCode: null,
      body: null,
      error: (result.stderr || result.stdout || "http probe failed").trim() || "http probe failed",
    };
  }

  try {
    const parsed = JSON.parse(String(result.stdout || "").trim()) as HttpProbeResult;
    return {
      ok: parsed.ok === true,
      statusCode: Number.isInteger(parsed.statusCode) ? parsed.statusCode : null,
      body: parsed.body ?? null,
      error: typeof parsed.error === "string" ? parsed.error : null,
    };
  } catch {
    return {
      ok: false,
      statusCode: null,
      body: null,
      error: "invalid http probe output",
    };
  }
}

function checkHttpJsonEndpoint(input: {
  name: string;
  label: string;
  url: string;
  optional?: boolean;
  validate: (statusCode: number, body: unknown) => boolean;
}) {
  const optional = input.optional === true;
  const probe = runHttpProbe(input.url);
  const validated = probe.ok && probe.statusCode !== null && input.validate(probe.statusCode, probe.body);

  if (validated) {
    return {
      name: input.name,
      ok: true,
      message: `${input.label} is reachable`,
      details: {
        optional,
        url: input.url,
        statusCode: probe.statusCode,
      },
    };
  }

  const message = probe.error
    ? `${input.label} is unreachable`
    : `${input.label} returned an unexpected response`;

  return {
    name: input.name,
    ok: false,
    message,
    details: {
      optional,
      url: input.url,
      statusCode: probe.statusCode,
      body: probe.body,
      error: probe.error,
    },
  };
}

function checkDispatcherHealth(dispatcherUrl: string) {
  const url = buildUrlWithPath(dispatcherUrl, "/health");
  return checkHttpJsonEndpoint({
    name: "dispatcher-health",
    label: "dispatcher /health",
    url,
    optional: true,
    validate: (statusCode, body) => {
      if (statusCode !== 200 || !isRecord(body)) {
        return false;
      }
      return body.status === "ok";
    },
  });
}

function checkAutomationReady(automationUrl: string) {
  const url = buildUrlWithPath(automationUrl, "/ready");
  return checkHttpJsonEndpoint({
    name: "automation-ready",
    label: "automation /ready",
    url,
    optional: true,
    validate: (statusCode, body) => {
      if (statusCode !== 200 || !isRecord(body)) {
        return false;
      }
      const data = isRecord(body.data) ? body.data : null;
      return data?.ready === true || body.ready === true;
    },
  });
}

function checkRemoteDebuggingPort(remoteDebuggingPort: number) {
  const url = `http://127.0.0.1:${remoteDebuggingPort}/json/version`;
  return checkHttpJsonEndpoint({
    name: "remote-debugging",
    label: "Trae remote debugging endpoint",
    url,
    optional: true,
    validate: (statusCode, body) => {
      if (statusCode !== 200 || !isRecord(body)) {
        return false;
      }
      return typeof body.webSocketDebuggerUrl === "string" && body.webSocketDebuggerUrl.length > 0;
    },
  });
}

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

  checks.push(checkDispatcherHealth(config.dispatcherUrl));
  checks.push(checkAutomationReady(config.automationUrl));
  checks.push(checkRemoteDebuggingPort(config.remoteDebuggingPort));

  return {
    ok: checks.every((item) => item.ok || isOptionalCheck(item)),
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
    const optionalTag = isOptionalCheck(check) ? " [optional]" : "";
    lines.push(`- ${check.name}: ${check.ok ? "ok" : "fail"}${optionalTag}${check.message ? ` (${check.message})` : ""}`);
  }

  return lines.join("\n");
}
