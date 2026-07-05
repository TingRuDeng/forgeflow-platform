import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

import { readJson } from "./utils.js";
import { buildAssignmentArtifactBundle } from "./assignment-artifacts.js";
import type { TaskAssignment, WorkerResult } from "./types.js";
import type {
  AssignmentLaunchCommand,
  AssignmentVerificationCommand,
  CommandResult,
  RunWorkerAssignmentCliOptions,
  RunWorkerAssignmentInput,
  RunWorkerAssignmentSummary,
} from "./run-worker-assignment-types.js";

export type {
  AssignmentLaunchCommand,
  AssignmentLaunchInput,
  AssignmentVerificationCommand,
  CommandResult,
  RunWorkerAssignmentInput,
  RunWorkerAssignmentSummary,
} from "./run-worker-assignment-types.js";
export { buildCodexLaunchCommand, buildGeminiLaunchCommand } from "./provider-launch.js";

const DEFAULT_EXEC_TIMEOUT_MS = 300_000;
const DEFAULT_VERIFICATION_TIMEOUT_MS = 60_000;

let resolvedVerificationShell = "";

export function buildAssignmentPrompt(workerPrompt: string, contextMarkdown: string): string {
  return `${workerPrompt.trim()}\n\n${contextMarkdown.trim()}\n`;
}

export function buildVerificationCommands(assignment: TaskAssignment, worktreeDir: string): AssignmentVerificationCommand[] {
  const shell = getVerificationShell();
  return Object.values(assignment.commands ?? {}).map((command) => ({
    command,
    argv: [
      shell,
      "-lc",
      `export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; nvm use 22 >/dev/null 2>&1 || true; ${command}`,
    ],
    cwd: worktreeDir,
  }));
}

export interface WorkerRuntimeLike {
  launchTask(input: { taskId: string; prompt: string; mode: "run"; worktreeDir: string }): { argv: string[] };
}

export interface DispatcherRuntimeLaunchOptions {
  codexModel?: string;
  geminiModel: string;
  createCodexRuntime: (role: "worker", options?: { model?: string }) => WorkerRuntimeLike;
  createGeminiRuntime: (options?: { model?: string; extraArgs?: string[] }) => WorkerRuntimeLike;
}

export function buildDispatcherRuntimeLaunchCommand(
  input: { assignment: TaskAssignment; prompt: string; worktreeDir: string },
  options: DispatcherRuntimeLaunchOptions,
): AssignmentLaunchCommand {
  const launchInput = {
    taskId: input.assignment.taskId,
    prompt: input.prompt,
    mode: "run" as const,
    worktreeDir: input.worktreeDir,
  };
  if (input.assignment.pool === "codex") {
    const runtime = options.createCodexRuntime("worker", { model: options.codexModel?.trim() || undefined });
    return {
      provider: "codex",
      argv: runtime.launchTask(launchInput).argv,
      cwd: input.worktreeDir,
    };
  }

  const runtime = options.createGeminiRuntime({ model: options.geminiModel });
  return {
    provider: "gemini",
    argv: runtime.launchTask(launchInput).argv,
    cwd: input.worktreeDir,
  };
}

export async function runWorkerAssignment(input: RunWorkerAssignmentInput): Promise<RunWorkerAssignmentSummary> {
  const assignmentDir = path.resolve(input.assignmentDir);
  const outputDir = path.resolve(input.outputDir || assignmentDir);
  const worktreeDir = path.resolve(input.worktreeDir);
  ensureWorkspaceDependencies(worktreeDir);

  const assignment = readJson(path.join(assignmentDir, "assignment.json")) as TaskAssignment;
  const workerPrompt = fs.readFileSync(path.join(assignmentDir, "worker-prompt.md"), "utf8");
  const contextMarkdown = fs.readFileSync(path.join(assignmentDir, "context.md"), "utf8");
  const prompt = buildAssignmentPrompt(workerPrompt, contextMarkdown);
  const launch = await input.buildLaunchCommand({ assignment, prompt, worktreeDir });
  const verificationCommands = buildVerificationCommands(assignment, worktreeDir);

  if (input.dryRun) {
    return {
      status: "dry_run",
      assignmentDir,
      outputDir,
      launch,
      verificationCommands,
    };
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const launchResult = await runCommandWithTimeout(launch, input.execTimeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS);
  const verification = [];
  for (const command of verificationCommands) {
    const result = await runCommandWithTimeout(command, input.verificationTimeoutMs ?? DEFAULT_VERIFICATION_TIMEOUT_MS);
    verification.push({
      command: command.command,
      exitCode: result.exitCode,
      output: result.output,
      timedOut: result.timedOut,
    });
  }

  const finalOutput = launchResult.timedOut
    ? `${launchResult.output}\n\n[TIMEOUT] worker execution timed out after ${input.execTimeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS}ms`
    : launchResult.output;
  const workerResult = buildWorkerResult({
    assignment,
    launch,
    launchExitCode: launchResult.exitCode,
    launchTimedOut: Boolean(launchResult.timedOut),
    provider: launch.provider,
    output: finalOutput,
    launchOutput: launchResult.output,
    verification,
    generatedAt: input.generatedAt?.() ?? new Date().toISOString(),
  });
  writeWorkerResultFiles(outputDir, workerResult, finalOutput);

  const failed = launchResult.exitCode !== 0 || Boolean(launchResult.timedOut) || !workerResult.verification.allPassed;
  return {
    status: failed ? "failed" : "completed",
    provider: launch.provider,
    taskId: assignment.taskId,
    outputDir,
    verificationPassed: workerResult.verification.allPassed,
    timedOut: Boolean(launchResult.timedOut),
  };
}

function resolveVerificationShell(): string {
  const candidates = [
    process.env.FORGEFLOW_VERIFICATION_SHELL?.trim(),
    "zsh",
    "bash",
    "sh",
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["-lc", "exit 0"], { encoding: "utf8" });
    if ((probe.status ?? 1) === 0) {
      return candidate;
    }
    if ((probe.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
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
  return path.dirname(path.resolve(worktreeDir, commonDir));
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
  if (fs.existsSync(sharedNodeModules)) {
    fs.symlinkSync(sharedNodeModules, nodeModulesPath, "junction");
  }
}

function runCommandWithTimeout(
  command: AssignmentLaunchCommand | AssignmentVerificationCommand,
  timeoutMs: number,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const proc = spawn(command.argv[0], command.argv.slice(1), { cwd: command.cwd });
    const timer = setTimeout(() => {
      timedOut = true;
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
        exitCode: timedOut ? 124 : (code ?? 1),
        output: `${stdout}${stderr}`.trim(),
        timedOut,
      });
    });
    proc.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        exitCode: 1,
        output: `${stdout}${stderr}`.trim(),
        error: error.message,
        timedOut: false,
      });
    });
  });
}

function buildWorkerResult(input: {
  assignment: TaskAssignment;
  launch: AssignmentLaunchCommand;
  launchExitCode: number;
  launchTimedOut: boolean;
  provider: string;
  output: string;
  launchOutput: string;
  verification: Array<{ command: string; exitCode: number; output: string; timedOut?: boolean }>;
  generatedAt: string;
}): WorkerResult {
  return {
    taskId: input.assignment.taskId,
    workerId: input.assignment.workerId ?? "",
    provider: input.provider,
    pool: input.assignment.pool,
    branchName: input.assignment.branchName,
    repo: input.assignment.repo,
    defaultBranch: input.assignment.defaultBranch,
    mode: "run",
    output: input.output,
    generatedAt: input.generatedAt,
    verification: {
      allPassed: input.verification.every((item) => item.exitCode === 0),
      commands: input.verification,
    },
    artifactBundle: buildAssignmentArtifactBundle({
      assignment: input.assignment,
      launch: input.launch,
      launchOutput: input.launchOutput,
      launchExitCode: input.launchExitCode,
      launchTimedOut: input.launchTimedOut,
      verification: input.verification,
      finalOutput: input.output,
      generatedAt: input.generatedAt,
    }),
  };
}

function writeWorkerResultFiles(outputDir: string, workerResult: WorkerResult, rawOutput: string): void {
  fs.writeFileSync(path.join(outputDir, "worker-output.raw.txt"), `${rawOutput}\n`);
  fs.writeFileSync(path.join(outputDir, "worker-result.json"), `${JSON.stringify(workerResult, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDir, "worker-verification.json"), `${JSON.stringify(workerResult.verification, null, 2)}\n`);
}
