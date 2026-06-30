#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const GEMINI_MODEL = process.env.FORGEFLOW_GEMINI_MODEL?.trim() || "gemini-2.5-pro";
const GEMINI_BIN_OVERRIDE = process.env.FORGEFLOW_GEMINI_BIN?.trim() || "";
const GEMINI_ARGS_JSON = process.env.FORGEFLOW_GEMINI_ARGS_JSON?.trim() || "";
const GEMINI_ARGS_TEXT = process.env.FORGEFLOW_GEMINI_ARGS?.trim() || "";

const EXEC_TIMEOUT_MS = Number(process.env.FORGEFLOW_EXEC_TIMEOUT_MS) || 300_000;
const VERIFICATION_TIMEOUT_MS = Number(process.env.FORGEFLOW_VERIFICATION_TIMEOUT_MS) || 60_000;
let resolvedVerificationShell = "";
let resolvedGeminiBin = "";

interface ParsedArgs {
  outputDir: string;
  dryRun: boolean;
  assignmentDir?: string;
  worktreeDir?: string;
  help?: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    outputDir: "",
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--assignment-dir" && next) {
      args.assignmentDir = next;
      index += 1;
      continue;
    }
    if (arg === "--worktree-dir" && next) {
      args.worktreeDir = next;
      index += 1;
      continue;
    }
    if (arg === "--output-dir" && next) {
      args.outputDir = next;
      index += 1;
      continue;
    }
    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (arg === "--help") {
      args.help = true;
      continue;
    }

    throw new Error(`unknown argument: ${arg}`);
  }

  return args;
}

function printHelp(): void {
  console.log(`
Usage:
  node dist/runtime/run-worker-assignment.js \\
    --assignment-dir .orchestrator/assignments/task-1 \\
    --worktree-dir /abs/path/to/worktree \\
    [--output-dir /abs/path/to/output] \\
    [--dry-run]
`);
}

function validateArgs(args: ParsedArgs): void {
  if (!args.assignmentDir) {
    throw new Error("--assignment-dir is required");
  }
  if (!args.worktreeDir) {
    throw new Error("--worktree-dir is required");
  }
}

function readUtf8(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

function buildPrompt(workerPrompt: string, contextMarkdown: string): string {
  return `${workerPrompt.trim()}\n\n${contextMarkdown.trim()}\n`;
}

interface Assignment {
  taskId: string;
  workerId: string;
  pool: string;
  branchName: string;
  repo: string;
  defaultBranch: string;
  commands: Record<string, string>;
}

interface LaunchCommand {
  provider: string;
  argv: string[];
  cwd: string;
}

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

function parseGeminiExtraArgs(): string[] {
  if (GEMINI_ARGS_JSON) {
    try {
      const parsed = JSON.parse(GEMINI_ARGS_JSON) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error("FORGEFLOW_GEMINI_ARGS_JSON must be a JSON string array");
      }
      return parsed
        .map((item) => String(item).trim())
        .filter(Boolean);
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      throw new Error(`invalid FORGEFLOW_GEMINI_ARGS_JSON: ${details}`);
    }
  }

  if (!GEMINI_ARGS_TEXT) {
    return [];
  }
  return splitArgs(GEMINI_ARGS_TEXT);
}

function isCommandAvailable(command: string): boolean {
  const probe = spawnSync(command, ["--version"], {
    encoding: "utf8",
  });
  return (probe.error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT";
}

function resolveGeminiBin(): string {
  if (resolvedGeminiBin) {
    return resolvedGeminiBin;
  }

  const candidates = GEMINI_BIN_OVERRIDE
    ? [GEMINI_BIN_OVERRIDE]
    : ["gemini"];

  for (const candidate of candidates) {
    if (isCommandAvailable(candidate)) {
      resolvedGeminiBin = candidate;
      return resolvedGeminiBin;
    }
  }

  throw new Error(
    "gemini binary not found. Install gemini CLI or set FORGEFLOW_GEMINI_BIN to an executable path.",
  );
}

function buildGeminiRunArgs(prompt: string): string[] {
  const geminiBin = resolveGeminiBin();
  const argv = [geminiBin, "-m", GEMINI_MODEL];
  argv.push(...parseGeminiExtraArgs());
  argv.push("-p", prompt);
  return argv;
}

function buildLaunchCommand(assignment: Assignment, prompt: string, worktreeDir: string): LaunchCommand {
  if (assignment.pool !== "gemini") {
    throw new Error(`gemini runtime only supports pool=gemini, got ${assignment.pool}`);
  }

  return {
    provider: "gemini",
    argv: buildGeminiRunArgs(prompt),
    cwd: worktreeDir,
  };
}

interface VerificationCommand {
  command: string;
  argv: string[];
  cwd: string;
}

function buildVerificationCommands(assignment: Assignment, worktreeDir: string): VerificationCommand[] {
  const shell = getVerificationShell();
  return Object.values(assignment.commands).map((command) => ({
    command,
    argv: [
      shell,
      "-lc",
      `export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; nvm use 22 >/dev/null 2>&1 || true; ${command}`,
    ],
    cwd: worktreeDir,
  }));
}

function resolveVerificationShell(): string {
  const candidates = [
    process.env.FORGEFLOW_VERIFICATION_SHELL?.trim(),
    "zsh",
    "bash",
    "sh",
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["-lc", "exit 0"], {
      encoding: "utf8",
    });

    if ((probe.status ?? 1) === 0) {
      return candidate;
    }
    if ((probe.error as any)?.code === "ENOENT") {
      continue;
    }
  }

  throw new Error(`unable to find a compatible verification shell (${candidates.join(", ")})`);
}

function getVerificationShell(): string {
  if (!resolvedVerificationShell) {
    resolvedVerificationShell = resolveVerificationShell();
  }
  return resolvedVerificationShell;
}

function inferCommonRepoRoot(worktreeDir: string): string | null {
  const result = spawnSync("git", ["rev-parse", "--git-common-dir"], {
    cwd: worktreeDir,
    encoding: "utf8",
  });

  if ((result.status ?? 1) !== 0) {
    return null;
  }

  const commonDir = result.stdout.trim();
  if (!commonDir) {
    return null;
  }

  const resolved = path.resolve(worktreeDir, commonDir);
  return path.dirname(resolved);
}

function ensureWorkspaceDependencies(worktreeDir: string): void {
  const nodeModulesPath = path.join(worktreeDir, "node_modules");
  if (fs.existsSync(nodeModulesPath)) {
    return;
  }

  const commonRepoRoot = inferCommonRepoRoot(worktreeDir);
  if (!commonRepoRoot) {
    return;
  }

  const sharedNodeModules = path.join(commonRepoRoot, "node_modules");
  if (!fs.existsSync(sharedNodeModules)) {
    return;
  }

  fs.symlinkSync(sharedNodeModules, nodeModulesPath, "junction");
}

interface CommandResult {
  exitCode: number;
  output: string;
  killed?: boolean;
  timedOut?: boolean;
  error?: string;
}

function runCommandWithTimeout(command: VerificationCommand | LaunchCommand, timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let killed = false;

    const proc = spawn(command.argv[0], command.argv.slice(1), {
      cwd: command.cwd,
    });

    const timer = setTimeout(() => {
      killed = true;
      proc.kill("SIGKILL");
    }, timeoutMs);

    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: killed ? 124 : (code ?? 1),
        output: `${stdout}${stderr}`.trim(),
        killed,
        timedOut: killed,
      });
    });

    proc.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        exitCode: 1,
        output: `${stdout}${stderr}`.trim(),
        error: error.message,
        killed: false,
        timedOut: false,
      });
    });
  });
}

interface WorkerResult {
  taskId: string;
  workerId: string;
  provider: string;
  pool: string;
  branchName: string;
  repo: string;
  defaultBranch: string;
  mode: string;
  output: string;
  generatedAt: string;
  verification: {
    allPassed: boolean;
    commands: Array<{
      command: string;
      exitCode: number;
      output: string;
      timedOut?: boolean;
    }>;
  };
}

function buildWorkerResult({ assignment, provider, output, verification, generatedAt }: { assignment: Assignment; provider: string; output: string; verification: Array<{ command: string; exitCode: number; output: string; timedOut?: boolean }>; generatedAt: string }): WorkerResult {
  return {
    taskId: assignment.taskId,
    workerId: assignment.workerId,
    provider,
    pool: assignment.pool,
    branchName: assignment.branchName,
    repo: assignment.repo,
    defaultBranch: assignment.defaultBranch,
    mode: "run",
    output,
    generatedAt,
    verification: {
      allPassed: verification.every((item) => item.exitCode === 0),
      commands: verification,
    },
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  validateArgs(args);

  const assignmentDir = path.resolve(args.assignmentDir!);
  const outputDir = path.resolve(args.outputDir || assignmentDir);
  ensureWorkspaceDependencies(args.worktreeDir!);
  const assignment = JSON.parse(readUtf8(path.join(assignmentDir, "assignment.json"))) as Assignment;
  const workerPrompt = readUtf8(path.join(assignmentDir, "worker-prompt.md"));
  const contextMarkdown = readUtf8(path.join(assignmentDir, "context.md"));
  const prompt = buildPrompt(workerPrompt, contextMarkdown);
  const launch = buildLaunchCommand(assignment, prompt, args.worktreeDir!);
  const verificationCommands = buildVerificationCommands(assignment, args.worktreeDir!);

  if (args.dryRun) {
    console.log(JSON.stringify({
      assignmentDir,
      outputDir,
      launch,
      verificationCommands,
    }, null, 2));
    return;
  }

  fs.mkdirSync(outputDir, { recursive: true });

  const launchResult = await runCommandWithTimeout(launch, EXEC_TIMEOUT_MS);
  if (launchResult.timedOut) {
    console.error(`gemini run timed out after ${EXEC_TIMEOUT_MS}ms, killing process...`);
  }

  const verification = [];
  for (const command of verificationCommands) {
    const result = await runCommandWithTimeout(command, VERIFICATION_TIMEOUT_MS);
    verification.push({
      command: command.command,
      exitCode: result.exitCode,
      output: result.output,
      timedOut: result.timedOut,
    });
  }

  const generatedAt = new Date().toISOString();

  const finalOutput = launchResult.timedOut
    ? `${launchResult.output}\n\n[TIMEOUT] gemini run timed out after ${EXEC_TIMEOUT_MS}ms`
    : launchResult.output;

  const workerResult = buildWorkerResult({
    assignment,
    provider: launch.provider,
    output: finalOutput,
    verification,
    generatedAt,
  });

  fs.writeFileSync(path.join(outputDir, "worker-output.raw.txt"), `${finalOutput}\n`);
  fs.writeFileSync(
    path.join(outputDir, "worker-result.json"),
    `${JSON.stringify(workerResult, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(outputDir, "worker-verification.json"),
    `${JSON.stringify(workerResult.verification, null, 2)}\n`,
  );

  const isFailed = launchResult.exitCode !== 0 || launchResult.timedOut || !workerResult.verification.allPassed;
  console.log(JSON.stringify({
    status: isFailed ? "failed" : "completed",
    provider: launch.provider,
    taskId: assignment.taskId,
    outputDir,
    verificationPassed: workerResult.verification.allPassed,
    timedOut: launchResult.timedOut,
  }, null, 2));

  if (isFailed) {
    process.exit(launchResult.timedOut ? 124 : (launchResult.exitCode || 1));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
