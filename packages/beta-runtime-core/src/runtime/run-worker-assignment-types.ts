import type { TaskAssignment } from "./types.js";
import type {
  ExecutionProfile,
  ExecutionProfileName,
  ExecutionProfileProbe,
} from "./execution-profile.js";

export interface AssignmentLaunchCommand {
  provider: string;
  argv: string[];
  cwd: string;
  executionProfile?: ExecutionProfileName;
}

export interface AssignmentVerificationCommand {
  command: string;
  argv: string[];
  cwd: string;
  executionProfile?: ExecutionProfileName;
}

export interface AssignmentLaunchInput {
  assignment: TaskAssignment;
  prompt: string;
  worktreeDir: string;
  env?: Record<string, string | undefined>;
}

export interface RunWorkerAssignmentInput {
  assignmentDir: string;
  worktreeDir: string;
  outputDir: string;
  dryRun?: boolean;
  execTimeoutMs?: number;
  verificationTimeoutMs?: number;
  generatedAt?: () => string;
  executionProfile?: ExecutionProfile;
  executionProfileProbe?: ExecutionProfileProbe;
  executionEnv?: Record<string, string | undefined>;
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
    executionProfile: ExecutionProfileName;
    launch: AssignmentLaunchCommand;
    verificationCommands: AssignmentVerificationCommand[];
  }
  | {
    status: "completed" | "failed";
    provider: string;
    taskId: string;
    outputDir: string;
    executionProfile: ExecutionProfileName;
    verificationPassed: boolean;
    timedOut: boolean;
  };

export interface CommandResult {
  exitCode: number;
  output: string;
  timedOut?: boolean;
  error?: string;
}
