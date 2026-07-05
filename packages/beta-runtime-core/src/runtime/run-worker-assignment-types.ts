import type { TaskAssignment } from "./types.js";

export interface AssignmentLaunchCommand {
  provider: string;
  argv: string[];
  cwd: string;
}

export interface AssignmentVerificationCommand {
  command: string;
  argv: string[];
  cwd: string;
}

export interface AssignmentLaunchInput {
  assignment: TaskAssignment;
  prompt: string;
  worktreeDir: string;
}

export interface RunWorkerAssignmentInput {
  assignmentDir: string;
  worktreeDir: string;
  outputDir: string;
  dryRun?: boolean;
  execTimeoutMs?: number;
  verificationTimeoutMs?: number;
  generatedAt?: () => string;
  buildLaunchCommand: (input: AssignmentLaunchInput) => AssignmentLaunchCommand | Promise<AssignmentLaunchCommand>;
}

export interface RunWorkerAssignmentCliOptions {
  argv?: string[];
  usageCommand: string;
  buildLaunchCommand: RunWorkerAssignmentInput["buildLaunchCommand"];
  execTimeoutMs?: number;
  verificationTimeoutMs?: number;
  generatedAt?: () => string;
}

export type RunWorkerAssignmentSummary =
  | {
    status: "dry_run";
    assignmentDir: string;
    outputDir: string;
    launch: AssignmentLaunchCommand;
    verificationCommands: AssignmentVerificationCommand[];
  }
  | {
    status: "completed" | "failed";
    provider: string;
    taskId: string;
    outputDir: string;
    verificationPassed: boolean;
    timedOut: boolean;
  };

export interface CommandResult {
  exitCode: number;
  output: string;
  timedOut?: boolean;
  error?: string;
}
