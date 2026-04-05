#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

interface ParsedArgs {
  changedFiles: string[];
  taskLedgerFile?: string;
  taskEventsFile?: string;
  workerRegistryFile?: string;
  workerResultFile?: string;
  reviewMaterialFile?: string;
  help?: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    changedFiles: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--task-ledger-file" && next) {
      args.taskLedgerFile = next;
      index += 1;
      continue;
    }
    if (arg === "--task-events-file" && next) {
      args.taskEventsFile = next;
      index += 1;
      continue;
    }
    if (arg === "--worker-registry-file" && next) {
      args.workerRegistryFile = next;
      index += 1;
      continue;
    }
    if (arg === "--worker-result-file" && next) {
      args.workerResultFile = next;
      index += 1;
      continue;
    }
    if (arg === "--review-material-file" && next) {
      args.reviewMaterialFile = next;
      index += 1;
      continue;
    }
    if (arg === "--changed-files" && next) {
      args.changedFiles = next
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      index += 1;
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
  node scripts/process-worker-result.js \\
    --task-ledger-file /abs/path/to/task-ledger.json \\
    --task-events-file /abs/path/to/task-events.json \\
    --worker-registry-file /abs/path/to/worker-registry.json \\
    --worker-result-file /abs/path/to/worker-result.json \\
    [--review-material-file /abs/path/to/review-material.json] \\
    [--changed-files src/auth.ts,tests/auth.test.ts]
`);
}

function ensureRequired(args: ParsedArgs, key: keyof ParsedArgs): void {
  if (!args[key]) {
    throw new Error(`--${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)} is required`);
  }
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(path.resolve(filePath), `${JSON.stringify(value, null, 2)}\n`);
}

interface TaskEvent {
  taskId: string;
  type: string;
  at: string;
  payload: Record<string, unknown>;
}

function appendTransition(events: TaskEvent[], taskId: string, at: string, from: string, to: string): void {
  events.push({
    taskId,
    type: "status_changed",
    at,
    payload: {
      from,
      to,
    },
  });
}

interface WorkerResult {
  taskId: string;
  workerId: string;
  generatedAt: string;
  verification: {
    allPassed: boolean;
    commands: Array<{
      command: string;
      exitCode: number;
      output: string;
    }>;
  };
  repo: string;
}

interface Task {
  id: string;
  status: string;
  title?: string;
}

interface TaskLedger {
  tasks: Task[];
}

interface Worker {
  id: string;
  status: string;
  lastHeartbeatAt: string;
  currentTaskId?: string;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  ensureRequired(args, "taskLedgerFile");
  ensureRequired(args, "taskEventsFile");
  ensureRequired(args, "workerRegistryFile");
  ensureRequired(args, "workerResultFile");

  const ledger = readJson(args.taskLedgerFile!) as TaskLedger;
  const events = readJson(args.taskEventsFile!) as TaskEvent[];
  const workers = readJson(args.workerRegistryFile!) as Worker[];
  const workerResult = readJson(args.workerResultFile!) as WorkerResult;

  const task = ledger.tasks.find((candidate) => candidate.id === workerResult.taskId);
  if (!task) {
    throw new Error(`task not found: ${workerResult.taskId}`);
  }

  const worker = workers.find((candidate) => candidate.id === workerResult.workerId);
  if (!worker) {
    throw new Error(`worker not found: ${workerResult.workerId}`);
  }

  if (task.status === "assigned") {
    appendTransition(events, task.id, workerResult.generatedAt, "assigned", "in_progress");
    task.status = "in_progress";
  } else if (task.status !== "in_progress") {
    throw new Error(`task is not executing: ${task.id}`);
  }

  let reviewMaterial: {
    repo: string;
    title: string;
    changedFiles: string[];
    selfTestPassed: boolean;
    checks: string[];
  } | undefined;
  if (workerResult.verification.allPassed) {
    appendTransition(events, task.id, workerResult.generatedAt, "in_progress", "review");
    task.status = "review";
    reviewMaterial = {
      repo: workerResult.repo,
      title: ledger.tasks.find((t) => t.id === task.id)?.title || "",
      changedFiles: args.changedFiles,
      selfTestPassed: true,
      checks: workerResult.verification.commands.map((item) => item.command),
    };
  } else {
    appendTransition(events, task.id, workerResult.generatedAt, "in_progress", "failed");
    task.status = "failed";
  }

  worker.status = "idle";
  worker.lastHeartbeatAt = workerResult.generatedAt;
  delete worker.currentTaskId;

  writeJson(args.taskLedgerFile!, ledger);
  writeJson(args.taskEventsFile!, events);
  writeJson(args.workerRegistryFile!, workers);

  if (args.reviewMaterialFile && reviewMaterial) {
    writeJson(args.reviewMaterialFile, reviewMaterial);
  }

  console.log(JSON.stringify({
    taskId: task.id,
    nextStatus: task.status,
    workerId: worker.id,
    workerStatus: worker.status,
    reviewMaterialWritten: Boolean(args.reviewMaterialFile && reviewMaterial),
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
