#!/usr/bin/env node

import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildSingleTaskDispatchInput, runDispatch } from "./dispatch.js";
import { runDecide } from "./decide.js";
import { runInspect } from "./inspect.js";
import { runRedrive } from "./redrive.js";
import { runUpdate } from "./update.js";
import { watchTask } from "./watch.js";

import packageJson from "../package.json" with { type: "json" };

export interface CliDeps {
  runDispatch: typeof runDispatch;
  watchTask: typeof watchTask;
  runDecide: typeof runDecide;
  runInspect: typeof runInspect;
  runRedrive: typeof runRedrive;
  runUpdate: typeof runUpdate;
  log: (message: string) => void;
}

export interface ParsedCliArgs {
  command: "dispatch" | "dispatch-task" | "continue-task" | "watch" | "decide" | "inspect" | "redrive" | "update" | "version";
  options: Record<string, string | number | boolean>;
}

function parseValue(raw: string) {
  if (raw === "true") {
    return true;
  }
  if (raw === "false") {
    return false;
  }
  if (/^-?\d+$/.test(raw)) {
    return Number(raw);
  }
  return raw;
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const [command, ...rest] = argv;
  if (!command) {
    throw new Error("command is required");
  }
  if (!["dispatch", "dispatch-task", "continue-task", "watch", "decide", "inspect", "redrive", "update", "version"].includes(command)) {
    throw new Error(`unknown command: ${command}`);
  }

  const options: Record<string, string | number | boolean> = {};
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg || !arg.startsWith("--")) {
      throw new Error(`unknown argument: ${arg}`);
    }

    const key = arg.slice(2).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }
    options[key] = parseValue(next);
    index += 1;
  }

  return {
    command: command as ParsedCliArgs["command"],
    options,
  };
}

function printHelp() {
  console.log(`
Usage:
  forgeflow-review-orchestrator dispatch --dispatcher-url http://127.0.0.1:8787 --input dispatch.json
  forgeflow-review-orchestrator dispatch --dispatcher-url http://127.0.0.1:8787 --input dispatch.json --target-worker-id trae-remote-forgeflow
  forgeflow-review-orchestrator dispatch --dispatcher-url http://127.0.0.1:8787 --input dispatch.json --follow-up-of-task-id dispatch-1:task-1 --target-worker-id trae-remote-forgeflow
  forgeflow-review-orchestrator dispatch --dispatcher-url http://127.0.0.1:8787 --input dispatch.json --require-existing-worker
  forgeflow-review-orchestrator dispatch-task --dispatcher-url http://127.0.0.1:8787 --repo TingRuDeng/ForgeFlow --default-branch main --task-id task-1 --title "Update docs" --pool trae --branch-name ai/trae/task-1 --allowed-paths docs/**,README.md --acceptance "pnpm typecheck,git diff --check"
  forgeflow-review-orchestrator dispatch-task --dispatcher-url http://127.0.0.1:8787 --repo TingRuDeng/ForgeFlow --default-branch main --task-id task-1 --title "Update docs" --pool trae --branch-name ai/trae/task-1 --target-worker-id trae-local-forgeflow --require-existing-worker
  forgeflow-review-orchestrator dispatch-task --dispatcher-url http://127.0.0.1:8787 --repo TingRuDeng/ForgeFlow --default-branch main --task-id task-1 --title "Update docs" --pool trae --branch-name ai/trae/task-1 --follow-up-of-task-id dispatch-1:task-1 --target-worker-id trae-local-forgeflow
  forgeflow-review-orchestrator dispatch-task --dispatcher-url http://127.0.0.1:8787 --repo TingRuDeng/ForgeFlow --default-branch main --task-id task-1 --title "Update docs" --pool trae --branch-name ai/trae/task-1 --strict-task-spec --goal "Update worker prompt builder" --source-of-truth "prompts/dispatch-task-template.md,skills/worker-review-orchestrator/SKILL.md" --required-changes "add strict task spec validation,build structured context markdown" --non-goals "do not change dispatcher runtime" --must-preserve "existing dispatch-task behavior remains additive"
  forgeflow-review-orchestrator dispatch-task --dispatcher-url http://127.0.0.1:8787 --repo TingRuDeng/ForgeFlow --default-branch main --task-id task-1 --title "Update docs" --pool trae --branch-name ai/trae/task-1 --worker-prompt-file prompts/worker.md --context-markdown-file context/task.md
  forgeflow-review-orchestrator continue-task --dispatcher-url http://127.0.0.1:8787 --task-id dispatch-1:task-1
  forgeflow-review-orchestrator watch --dispatcher-url http://127.0.0.1:8787 --task-id dispatch-1:task-1
  forgeflow-review-orchestrator watch --dispatcher-url http://127.0.0.1:8787 --task-id dispatch-1:task-1 --summary
  forgeflow-review-orchestrator decide --dispatcher-url http://127.0.0.1:8787 --task-id dispatch-1:task-1 --decision merge
  forgeflow-review-orchestrator decide --state-dir /path/to/.forgeflow-dispatcher --task-id dispatch-1:task-1 --decision block
  forgeflow-review-orchestrator inspect --dispatcher-url http://127.0.0.1:8787 --task-id dispatch-1:task-1
  forgeflow-review-orchestrator inspect --dispatcher-url http://127.0.0.1:8787 --task-id dispatch-1:task-1 --summary
  forgeflow-review-orchestrator inspect --state-dir /path/to/.forgeflow-dispatcher --task-id dispatch-1:task-1
  forgeflow-review-orchestrator inspect --state-dir /path/to/.forgeflow-dispatcher --task-id dispatch-1:task-1 --summary
  forgeflow-review-orchestrator redrive --dispatcher-url http://127.0.0.1:8787 --task-id dispatch-1:task-1
  forgeflow-review-orchestrator update
  forgeflow-review-orchestrator update --help
`);
}

export async function runCli(argv: string[], partialDeps: Partial<CliDeps> = {}) {
  const deps: CliDeps = {
    runDispatch,
    watchTask,
    runDecide,
    runInspect,
    runRedrive,
    runUpdate,
    log: (message) => console.log(message),
    ...partialDeps,
  };

  const parsed = parseCliArgs(argv);
  const options = parsed.options;

  if (parsed.command === "update" && options.help === true) {
    deps.log(`forgeflow-review-orchestrator update - Update the globally installed CLI package

Usage: forgeflow-review-orchestrator update [options]

Description:
  Updates the globally installed @tingrudeng/worker-review-orchestrator-cli package
  to the latest version (or a specific dist-tag) via npm.

Options:
  -h, --help              Show this help message
  --default-branch <tag>  npm dist-tag to install (default: latest)

Examples:
  forgeflow-review-orchestrator update
  forgeflow-review-orchestrator update --default-branch next
`);
    return null;
  }

  if (options.help === true) {
    printHelp();
    return null;
  }

  if (parsed.command === "dispatch") {
    const dispatcherUrl = typeof options.dispatcherUrl === "string" ? options.dispatcherUrl : undefined;
    const input = typeof options.input === "string" ? options.input : "-";
    if (!dispatcherUrl) {
      throw new Error("--dispatcher-url is required");
    }
    const followUpOfTaskId = typeof options.followUpOfTaskId === "string" ? options.followUpOfTaskId : undefined;
    const targetWorkerId = typeof options.targetWorkerId === "string" ? options.targetWorkerId : undefined;
    if (followUpOfTaskId && !targetWorkerId) {
      throw new Error("--target-worker-id is required when --follow-up-of-task-id is provided");
    }
    const result = await deps.runDispatch({
      dispatcherUrl,
      input,
      requireExistingWorker: options.requireExistingWorker === true,
      targetWorkerId,
      requestTimeoutMs: typeof options.requestTimeoutMs === "number" ? options.requestTimeoutMs : undefined,
      followUpOfTaskId,
      workerChangeReason: typeof options.workerChangeReason === "string" ? options.workerChangeReason : undefined,
    });
    deps.log(JSON.stringify(result, null, 2));
    return result;
  }

  if (parsed.command === "dispatch-task") {
    const dispatcherUrl = typeof options.dispatcherUrl === "string" ? options.dispatcherUrl : undefined;
    const repo = typeof options.repo === "string" ? options.repo : undefined;
    const defaultBranch = typeof options.defaultBranch === "string" ? options.defaultBranch : undefined;
    const taskId = typeof options.taskId === "string" ? options.taskId : undefined;
    const title = typeof options.title === "string" ? options.title : undefined;
    const pool = typeof options.pool === "string" ? options.pool : undefined;
    const branchName = typeof options.branchName === "string" ? options.branchName : undefined;
    if (!dispatcherUrl) {
      throw new Error("--dispatcher-url is required");
    }
    if (!repo || !defaultBranch || !taskId || !title || !pool || !branchName) {
      throw new Error("--repo, --default-branch, --task-id, --title, --pool, and --branch-name are required");
    }

    const payload = buildSingleTaskDispatchInput({
      repo,
      defaultBranch,
      taskId,
      title,
      pool,
      branchName,
      requestedBy: typeof options.requestedBy === "string" ? options.requestedBy : undefined,
      allowedPaths: typeof options.allowedPaths === "string" ? options.allowedPaths : undefined,
      acceptance: typeof options.acceptance === "string" ? options.acceptance : undefined,
      dependsOn: typeof options.dependsOn === "string" ? options.dependsOn : undefined,
      targetWorkerId: typeof options.targetWorkerId === "string" ? options.targetWorkerId : undefined,
      verificationMode: typeof options.verificationMode === "string" ? options.verificationMode : undefined,
      workerPrompt: typeof options.workerPrompt === "string" ? options.workerPrompt : undefined,
      contextMarkdown: typeof options.contextMarkdown === "string" ? options.contextMarkdown : undefined,
      workerPromptFile: typeof options.workerPromptFile === "string" ? options.workerPromptFile : undefined,
      contextMarkdownFile: typeof options.contextMarkdownFile === "string" ? options.contextMarkdownFile : undefined,
      followUpOfTaskId: typeof options.followUpOfTaskId === "string" ? options.followUpOfTaskId : undefined,
      workerChangeReason: typeof options.workerChangeReason === "string" ? options.workerChangeReason : undefined,
      strictTaskSpec: options.strictTaskSpec === true,
      goal: typeof options.goal === "string" ? options.goal : undefined,
      sourceOfTruth: typeof options.sourceOfTruth === "string" ? options.sourceOfTruth : undefined,
      disallowedPaths: typeof options.disallowedPaths === "string" ? options.disallowedPaths : undefined,
      requiredChanges: typeof options.requiredChanges === "string" ? options.requiredChanges : undefined,
      nonGoals: typeof options.nonGoals === "string" ? options.nonGoals : undefined,
      mustPreserve: typeof options.mustPreserve === "string" ? options.mustPreserve : undefined,
      reworkMapping: typeof options.reworkMapping === "string" ? options.reworkMapping : undefined,
    });

    if (options.dryRun === true) {
      const dryRunResult = { dryRun: true, dispatcherUrl, payload };
      deps.log(JSON.stringify(dryRunResult, null, 2));
      return dryRunResult;
    }

    const followUpOfTaskId = typeof options.followUpOfTaskId === "string" ? options.followUpOfTaskId : undefined;
    const targetWorkerId = typeof options.targetWorkerId === "string" ? options.targetWorkerId : undefined;

    if (followUpOfTaskId && !targetWorkerId) {
      throw new Error("--target-worker-id is required when --follow-up-of-task-id is provided");
    }

    const result = await deps.runDispatch({
      dispatcherUrl,
      input: "-",
      payload,
      requireExistingWorker: options.requireExistingWorker === true,
      requestTimeoutMs: typeof options.requestTimeoutMs === "number" ? options.requestTimeoutMs : undefined,
      targetWorkerId,
      followUpOfTaskId,
      workerChangeReason: typeof options.workerChangeReason === "string" ? options.workerChangeReason : undefined,
    });
    deps.log(JSON.stringify(result, null, 2));
    return result;
  }

  if (parsed.command === "continue-task") {
    const dispatcherUrl = typeof options.dispatcherUrl === "string" ? options.dispatcherUrl : undefined;
    const taskId = typeof options.taskId === "string" ? options.taskId : undefined;
    if (!dispatcherUrl) {
      throw new Error("--dispatcher-url is required");
    }
    if (!taskId) {
      throw new Error("--task-id is required");
    }

    const result = await deps.runRedrive({
      dispatcherUrl,
      taskId,
    });
    deps.log(JSON.stringify(result, null, 2));
    return result;
  }

  if (parsed.command === "watch") {
    const dispatcherUrl = typeof options.dispatcherUrl === "string" ? options.dispatcherUrl : undefined;
    const taskId = typeof options.taskId === "string" ? options.taskId : undefined;
    if (!dispatcherUrl) {
      throw new Error("--dispatcher-url is required");
    }
    if (!taskId) {
      throw new Error("--task-id is required");
    }
    const result = await deps.watchTask({
      dispatcherUrl,
      taskId,
      intervalMs: typeof options.intervalMs === "number" ? options.intervalMs : undefined,
      timeoutMs: typeof options.timeoutMs === "number" ? options.timeoutMs : undefined,
      summary: options.summary === true,
    });
    deps.log(JSON.stringify(result, null, 2));
    return result;
  }

  if (parsed.command === "decide") {
    const taskId = typeof options.taskId === "string" ? options.taskId : undefined;
    const decision = typeof options.decision === "string" ? options.decision : undefined;
    if (!taskId) {
      throw new Error("--task-id is required");
    }
    if (!decision) {
      throw new Error("--decision is required");
    }
    const result = await deps.runDecide({
      taskId,
      decision: decision as "merge" | "block" | "rework",
      actor: typeof options.actor === "string" ? options.actor : undefined,
      notes: typeof options.notes === "string" ? options.notes : undefined,
      at: typeof options.at === "string" ? options.at : undefined,
      dispatcherUrl: typeof options.dispatcherUrl === "string" ? options.dispatcherUrl : undefined,
      stateDir: typeof options.stateDir === "string" ? options.stateDir : undefined,
    });
    deps.log(JSON.stringify(result, null, 2));
    return result;
  }

  if (parsed.command === "inspect") {
    const dispatcherUrl = typeof options.dispatcherUrl === "string" ? options.dispatcherUrl : undefined;
    const taskId = typeof options.taskId === "string" ? options.taskId : undefined;
    const stateDir = typeof options.stateDir === "string" ? options.stateDir : undefined;
    if (!dispatcherUrl && !stateDir) {
      throw new Error("--dispatcher-url or --state-dir is required");
    }
    if (!taskId) {
      throw new Error("--task-id is required");
    }
    const result = await deps.runInspect({
      dispatcherUrl,
      taskId,
      summary: options.summary === true,
      stateDir,
    });
    deps.log(JSON.stringify(result, null, 2));
    return result;
  }

  if (parsed.command === "redrive") {
    const dispatcherUrl = typeof options.dispatcherUrl === "string" ? options.dispatcherUrl : undefined;
    const taskId = typeof options.taskId === "string" ? options.taskId : undefined;
    if (!dispatcherUrl) {
      throw new Error("--dispatcher-url is required");
    }
    if (!taskId) {
      throw new Error("--task-id is required");
    }
    const result = await deps.runRedrive({
      dispatcherUrl,
      taskId,
    });
    deps.log(JSON.stringify(result, null, 2));
    return result;
  }

  if (parsed.command === "update") {
    const result = await deps.runUpdate({
      defaultBranch: typeof options.defaultBranch === "string" ? options.defaultBranch : "latest",
    });
    const lines: string[] = [];
    lines.push(`Package: ${result.packageName}`);
    lines.push(`Previous version: ${result.previousVersion}`);
    lines.push(`Installed version: ${result.installedVersion}`);
    lines.push(`Command: ${result.performedCommand}`);
    if (result.stdout) {
      lines.push(result.stdout);
    }
    if (result.message) {
      lines.push(result.message);
    }
    deps.log(lines.join("\n"));
    return result;
  }

  if (parsed.command === "version") {
    deps.log(packageJson.version);
    return null;
  }

  throw new Error(`unknown command: ${parsed.command}`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printHelp();
    return;
  }

  if (args[0] === "--version" || args[0] === "-v") {
    console.log(packageJson.version);
    return;
  }

  runCli(args).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

export function isCliEntrypoint(scriptPath = process.argv[1]) {
  if (!scriptPath) {
    return false;
  }
  const resolvedPath = scriptPath.startsWith("file:")
    ? fileURLToPath(scriptPath)
    : scriptPath;
  try {
    return import.meta.url === pathToFileURL(fs.realpathSync(resolvedPath)).href;
  } catch {
    return import.meta.url === pathToFileURL(resolvedPath).href;
  }
}

if (isCliEntrypoint()) {
  main();
}
