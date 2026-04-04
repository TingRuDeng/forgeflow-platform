import type {
  RuntimeLaunchInput,
  RuntimeVerificationInput,
  WorkerAssignmentPayload,
  WorkerExecutionResult,
  WorkerVerificationCommandResult,
} from "./types.js";
import { formatLocalTimestamp } from "../time.js";

export interface BuildLaunchInputFromAssignmentPackageInput {
  assignment: WorkerAssignmentPayload;
  workerPrompt: string;
  worktreeDir: string;
}

export interface BuildVerificationInputFromAssignmentPackageInput {
  assignment: WorkerAssignmentPayload;
  worktreeDir: string;
}

export interface BuildWorkerExecutionResultInput {
  assignment: WorkerAssignmentPayload;
  provider: "codex" | "gemini";
  output: string;
  verification: WorkerVerificationCommandResult[];
  generatedAt?: string;
}

export function buildLaunchInputFromAssignmentPackage(
  input: BuildLaunchInputFromAssignmentPackageInput,
): RuntimeLaunchInput {
  return {
    taskId: input.assignment.taskId,
    prompt: input.workerPrompt,
    mode: "run",
    worktreeDir: input.worktreeDir,
  };
}

export function buildVerificationInputFromAssignmentPackage(
  input: BuildVerificationInputFromAssignmentPackageInput,
): RuntimeVerificationInput {
  const allCommands = Object.values(input.assignment.commands);
  const uniqueCommands = [...new Set(allCommands)];
  const filteredCommands = uniqueCommands.filter(
    (cmd) => cmd !== undefined && cmd !== null && cmd.trim() !== "",
  );

  return {
    cwd: input.worktreeDir,
    commands: filteredCommands,
  };
}

export function buildWorkerExecutionResult(
  input: BuildWorkerExecutionResultInput,
): WorkerExecutionResult {
  return {
    taskId: input.assignment.taskId,
    workerId: input.assignment.workerId,
    provider: input.provider,
    pool: input.assignment.pool,
    branchName: input.assignment.branchName,
    repo: input.assignment.repo,
    defaultBranch: input.assignment.defaultBranch,
    mode: "run",
    output: input.output,
    generatedAt: input.generatedAt ?? formatLocalTimestamp(),
    verification: {
      allPassed: input.verification.every((item) => item.exitCode === 0),
      commands: input.verification,
    },
  };
}
