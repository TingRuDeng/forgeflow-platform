import { spawnSync } from "node:child_process";

import { isIsolatedExecutionProfile } from "./execution-profile.js";
import type { AssignmentLaunchCommand, AssignmentLaunchInput } from "./run-worker-assignment-types.js";

interface LaunchBuilderOptions {
  env?: Record<string, string | undefined>;
}

function splitArgs(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const args: string[] = [];
  let current = "";
  let quote = "";
  let escaped = false;
  for (const char of trimmed) {
    if (escaped) {
      current += char;
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (quote) {
      quote = char === quote ? "" : quote;
      if (quote) current += char;
    } else if (char === "\"" || char === "'") {
      quote = char;
    } else if (/\s/.test(char)) {
      if (current) args.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current) args.push(current);
  return args;
}

function parseExtraArgs(env: Record<string, string | undefined>, jsonKey: string, textKey: string): string[] {
  const argsJson = env[jsonKey]?.trim() || "";
  if (!argsJson) return splitArgs(env[textKey]?.trim() || "");
  try {
    const parsed = JSON.parse(argsJson) as unknown;
    if (!Array.isArray(parsed)) throw new Error(`${jsonKey} must be a JSON string array`);
    return parsed.map((item) => String(item).trim()).filter(Boolean);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new Error(`invalid ${jsonKey}: ${details}`);
  }
}

function isCommandAvailable(command: string): boolean {
  const probe = spawnSync(command, ["--version"], { encoding: "utf8" });
  return (probe.error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT";
}

function resolveProviderBin(env: Record<string, string | undefined>, envKey: string, fallback: string): string {
  const override = env[envKey]?.trim() || "";
  if (isIsolatedExecutionProfile(env)) {
    return override || fallback;
  }
  const candidates = override ? [override] : [fallback];
  for (const candidate of candidates) {
    if (isCommandAvailable(candidate)) return candidate;
  }
  throw new Error(`${fallback} binary not found. Install ${fallback} CLI or set ${envKey} to an executable path.`);
}

function assertPool(input: AssignmentLaunchInput, expectedPool: string): void {
  if (input.assignment.pool !== expectedPool) {
    throw new Error(`${expectedPool} runtime only supports pool=${expectedPool}, got ${input.assignment.pool}`);
  }
}

export function buildCodexLaunchCommand(
  input: AssignmentLaunchInput,
  options: LaunchBuilderOptions = {},
): AssignmentLaunchCommand {
  assertPool(input, "codex");
  const env = options.env ?? input.env ?? process.env;
  const argv = [resolveProviderBin(env, "FORGEFLOW_CODEX_BIN", "codex"), "exec"];
  const model = env.FORGEFLOW_CODEX_MODEL?.trim() || "";
  if (model) argv.push("-m", model);
  argv.push("--sandbox", env.FORGEFLOW_CODEX_SANDBOX?.trim() || "workspace-write");
  argv.push(...parseExtraArgs(env, "FORGEFLOW_CODEX_ARGS_JSON", "FORGEFLOW_CODEX_ARGS"));
  argv.push(input.prompt);
  return { provider: "codex", argv, cwd: input.worktreeDir };
}

export function buildGeminiLaunchCommand(
  input: AssignmentLaunchInput,
  options: LaunchBuilderOptions = {},
): AssignmentLaunchCommand {
  assertPool(input, "gemini");
  const env = options.env ?? input.env ?? process.env;
  return {
    provider: "gemini",
    argv: [
      resolveProviderBin(env, "FORGEFLOW_GEMINI_BIN", "gemini"),
      "-m",
      env.FORGEFLOW_GEMINI_MODEL?.trim() || "gemini-2.5-pro",
      ...parseExtraArgs(env, "FORGEFLOW_GEMINI_ARGS_JSON", "FORGEFLOW_GEMINI_ARGS"),
      "-p",
      input.prompt,
    ],
    cwd: input.worktreeDir,
  };
}
