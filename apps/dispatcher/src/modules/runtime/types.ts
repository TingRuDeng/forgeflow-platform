export type RuntimeMode = "run" | "review";

export interface RuntimeLaunchInput {
  taskId: string;
  prompt: string;
  mode: RuntimeMode;
  worktreeDir: string;
}

export interface AssignmentCommandMap {
  [name: string]: string;
}

export interface WorkerAssignmentPayload {
  taskId: string;
  workerId: string;
  pool: string;
  status: "assigned" | "pending";
  branchName: string;
  allowedPaths: string[];
  commands: AssignmentCommandMap;
  repo: string;
  defaultBranch: string;
}

export interface RuntimeLaunchCommand {
  argv: string[];
  cwd: string;
}

export interface RuntimeVerificationInput {
  cwd: string;
  commands: string[];
}

export interface RuntimeCollectedResult {
  taskId: string;
  mode: RuntimeMode;
  output: string;
}

export interface WorkerVerificationCommandResult {
  command: string;
  exitCode: number;
  output: string;
}

export interface WorkerExecutionResult {
  taskId: string;
  workerId: string;
  provider: "codex" | "gemini";
  pool: string;
  branchName: string;
  repo: string;
  defaultBranch: string;
  mode: RuntimeMode;
  output: string;
  generatedAt: string;
  verification: {
    allPassed: boolean;
    commands: WorkerVerificationCommandResult[];
  };
}

export interface NormalizedRuntimeResult extends RuntimeCollectedResult {
  provider: "codex" | "gemini";
}

export interface WorkerRuntime {
  provider: "codex" | "gemini";
  model: string;
  launchTask(input: RuntimeLaunchInput): RuntimeLaunchCommand;
  collectResult(input: RuntimeCollectedResult): NormalizedRuntimeResult;
  cancelTask(taskId: string): RuntimeLaunchCommand | null;
  runVerification(input: RuntimeVerificationInput): RuntimeLaunchCommand[];
  supportsMode(mode: RuntimeMode): boolean;
}

const UNSAFE_VERIFICATION_COMMAND_PATTERN = /[\0;&|<>`$()\\\n\r]/;

export function sanitizeVerificationCommand(command: string): string {
  if (UNSAFE_VERIFICATION_COMMAND_PATTERN.test(command)) {
    throw new Error("verification commands must not contain shell meta-characters");
  }
  return command;
}
