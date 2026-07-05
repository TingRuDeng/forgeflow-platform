import { runWorkerAssignment } from "./run-worker-assignment.js";
import type { RunWorkerAssignmentCliOptions } from "./run-worker-assignment-types.js";

interface ParsedArgs {
  outputDir: string;
  dryRun: boolean;
  assignmentDir?: string;
  worktreeDir?: string;
  help?: boolean;
}

export async function runWorkerAssignmentCli(options: RunWorkerAssignmentCliOptions): Promise<void> {
  const args = parseArgs(options.argv ?? process.argv.slice(2));
  if (args.help) {
    printHelp(options.usageCommand);
    return;
  }
  validateArgs(args);
  const summary = await runWorkerAssignment({
    assignmentDir: args.assignmentDir!,
    worktreeDir: args.worktreeDir!,
    outputDir: args.outputDir || args.assignmentDir!,
    dryRun: args.dryRun,
    execTimeoutMs: options.execTimeoutMs,
    verificationTimeoutMs: options.verificationTimeoutMs,
    generatedAt: options.generatedAt,
    buildLaunchCommand: options.buildLaunchCommand,
  });
  console.log(JSON.stringify(summary, null, 2));
  if (summary.status === "failed") {
    process.exit(summary.timedOut ? 124 : 1);
  }
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

function printHelp(usageCommand: string): void {
  console.log(`
Usage:
  ${usageCommand} \\
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
