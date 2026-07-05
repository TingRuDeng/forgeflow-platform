#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import {
  runWorkerAssignmentCli,
  type AssignmentLaunchCommand,
  type AssignmentLaunchInput,
} from "@tingrudeng/beta-runtime-core";

const CODEX_SANDBOX = process.env.FORGEFLOW_CODEX_SANDBOX?.trim() || "workspace-write";

let resolvedCodexBin = "";

function splitArgs(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }
  const args: string[] = [];
  let current = "";
  let quote = "";
  let escaped = false;
  for (const char of trimmed) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = "";
      } else {
        current += char;
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) {
    args.push(current);
  }
  return args;
}

function parseCodexExtraArgs(): string[] {
  const argsJson = process.env.FORGEFLOW_CODEX_ARGS_JSON?.trim() || "";
  if (argsJson) {
    try {
      const parsed = JSON.parse(argsJson) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error("FORGEFLOW_CODEX_ARGS_JSON must be a JSON string array");
      }
      return parsed.map((item) => String(item).trim()).filter(Boolean);
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      throw new Error(`invalid FORGEFLOW_CODEX_ARGS_JSON: ${details}`);
    }
  }
  return splitArgs(process.env.FORGEFLOW_CODEX_ARGS?.trim() || "");
}

function isCommandAvailable(command: string): boolean {
  const probe = spawnSync(command, ["--version"], { encoding: "utf8" });
  return (probe.error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT";
}

function resolveCodexBin(): string {
  if (resolvedCodexBin) {
    return resolvedCodexBin;
  }
  const override = process.env.FORGEFLOW_CODEX_BIN?.trim() || "";
  const candidates = override ? [override] : ["codex"];
  for (const candidate of candidates) {
    if (isCommandAvailable(candidate)) {
      resolvedCodexBin = candidate;
      return resolvedCodexBin;
    }
  }
  throw new Error("codex binary not found. Install codex CLI or set FORGEFLOW_CODEX_BIN to an executable path.");
}

function buildCodexExecArgs(prompt: string): string[] {
  const argv = [resolveCodexBin(), "exec"];
  const model = process.env.FORGEFLOW_CODEX_MODEL?.trim() || "";
  if (model) {
    argv.push("-m", model);
  }
  argv.push("--sandbox", CODEX_SANDBOX);
  argv.push(...parseCodexExtraArgs());
  argv.push(prompt);
  return argv;
}

export function buildCodexLaunchCommand(input: AssignmentLaunchInput): AssignmentLaunchCommand {
  if (input.assignment.pool !== "codex") {
    throw new Error(`codex runtime only supports pool=codex, got ${input.assignment.pool}`);
  }
  return {
    provider: "codex",
    argv: buildCodexExecArgs(input.prompt),
    cwd: input.worktreeDir,
  };
}

async function main(): Promise<void> {
  await runWorkerAssignmentCli({
    usageCommand: "node dist/runtime/run-worker-assignment.js",
    buildLaunchCommand: buildCodexLaunchCommand,
    execTimeoutMs: Number(process.env.FORGEFLOW_EXEC_TIMEOUT_MS) || undefined,
    verificationTimeoutMs: Number(process.env.FORGEFLOW_VERIFICATION_TIMEOUT_MS) || undefined,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
