#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

interface ParsedArgs {
  dryRun: boolean;
  orchestratorDir?: string;
  repoDir?: string;
  taskId?: string;
  help?: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--orchestrator-dir" && next) {
      args.orchestratorDir = next;
      index += 1;
      continue;
    }
    if (arg === "--repo-dir" && next) {
      args.repoDir = next;
      index += 1;
      continue;
    }
    if (arg === "--task-id" && next) {
      args.taskId = next;
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
  node scripts/run-dispatch-assignments.js \\
    --orchestrator-dir /abs/path/to/.orchestrator \\
    --repo-dir /abs/path/to/repo \\
    [--task-id task-1] \\
    [--dry-run]
`);
}

function ensureRequired(args: ParsedArgs, key: keyof ParsedArgs): void {
  if (!args[key]) {
    throw new Error(`--${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)} is required`);
  }
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

interface RunNodeScriptResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runNodeScript(scriptPath: string, scriptArgs: string[], cwd: string, env: NodeJS.ProcessEnv): RunNodeScriptResult {
  const result = spawnSync("node", [scriptPath, ...scriptArgs], {
    cwd,
    encoding: "utf8",
    env,
  });

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function collectChangedFiles(repoDir: string): string[] {
  const result = spawnSync("git", ["status", "--short"], {
    cwd: repoDir,
    encoding: "utf8",
  });

  if ((result.status ?? 1) !== 0) {
    return [];
  }

  return (result.stdout ?? "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeChangedFiles(lines: string[]): string[] {
  return lines
    .map((line) => line.replace(/^[A-Z?]{1,2}\s+/, "").trim())
    .filter(Boolean);
}

interface TaskAssignment {
  taskId: string;
  workerId: string;
  pool: string;
  status: string;
}

interface Task {
  id: string;
  title: string;
  pool: string;
  allowedPaths: string[];
  branchName: string;
  verification: {
    mode: string;
  };
  status: string;
  attempts: number;
  assignedWorkerId: string;
}

interface TaskLedger {
  requestSummary: string;
  taskType: string;
  repo: string;
  defaultBranch: string;
  generatedAt: string;
  tasks: Task[];
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  ensureRequired(args, "orchestratorDir");
  ensureRequired(args, "repoDir");

  const repoDir = path.resolve(args.repoDir!);
  const orchestratorDir = path.resolve(args.orchestratorDir!);
  const assignmentRecord = readJson(path.join(orchestratorDir, "task-assignments.json")) as TaskAssignment[];
  const taskLedger = readJson(path.join(orchestratorDir, "task-ledger.json")) as TaskLedger;

  const assignedTasks = assignmentRecord.filter((assignment) => assignment.status === "assigned");
  const filteredAssignments = args.taskId
    ? assignedTasks.filter((assignment) => assignment.taskId === args.taskId)
    : assignedTasks;

  const runWorkerAssignmentScript = path.resolve("scripts/run-worker-assignment.js");
  const processWorkerResultScript = path.resolve("scripts/process-worker-result.js");

  const summary = {
    repoDir,
    orchestratorDir,
    requestedTaskId: args.taskId ?? null,
    processedTasks: [] as Array<Record<string, unknown>>,
  };

  for (const assignment of filteredAssignments) {
    const assignmentDir = path.join(orchestratorDir, "assignments", assignment.taskId);
    const outputDir = path.join(assignmentDir, "execution");
    const workerResultFile = path.join(outputDir, "worker-result.json");
    const reviewMaterialFile = path.join(outputDir, "review-material.json");
    const task = taskLedger.tasks.find((candidate) => candidate.id === assignment.taskId);

    if (!task) {
      throw new Error(`task not found for assignment: ${assignment.taskId}`);
    }

    if (args.dryRun) {
      summary.processedTasks.push({
        taskId: assignment.taskId,
        workerId: assignment.workerId,
        status: "dry-run",
        assignmentDir,
        outputDir,
      });
      continue;
    }

    const workerRun = runNodeScript(
      runWorkerAssignmentScript,
      [
        "--assignment-dir",
        assignmentDir,
        "--worktree-dir",
        repoDir,
        "--output-dir",
        outputDir,
      ],
      process.cwd(),
      process.env,
    );

    if (workerRun.status !== 0) {
      throw new Error(workerRun.stderr.trim() || workerRun.stdout.trim() || `worker execution failed for ${assignment.taskId}`);
    }

    const changedFiles = normalizeChangedFiles(collectChangedFiles(repoDir));
    const processArgs = [
      "--task-ledger-file",
      path.join(orchestratorDir, "task-ledger.json"),
      "--task-events-file",
      path.join(orchestratorDir, "task-events.json"),
      "--worker-registry-file",
      path.join(orchestratorDir, "worker-registry.json"),
      "--worker-result-file",
      workerResultFile,
      "--review-material-file",
      reviewMaterialFile,
    ];
    if (changedFiles.length > 0) {
      processArgs.push("--changed-files", changedFiles.join(","));
    }
    const resultProcessing = runNodeScript(
      processWorkerResultScript,
      processArgs,
      process.cwd(),
      process.env,
    );

    if (resultProcessing.status !== 0) {
      throw new Error(resultProcessing.stderr.trim() || resultProcessing.stdout.trim() || `worker result processing failed for ${assignment.taskId}`);
    }

    const updatedLedger = readJson(path.join(orchestratorDir, "task-ledger.json")) as TaskLedger;
    const updatedTask = updatedLedger.tasks.find((candidate) => candidate.id === assignment.taskId);

    summary.processedTasks.push({
      taskId: assignment.taskId,
      workerId: assignment.workerId,
      branchName: task.branchName,
      status: updatedTask?.status ?? "unknown",
      changedFiles,
      outputDir,
    });
  }

  fs.writeFileSync(
    path.join(orchestratorDir, "execution-summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );

  console.log(JSON.stringify(summary, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
