#!/usr/bin/env node

import fs from "node:fs";
import { pathToFileURL } from "node:url";

import {
  readGeminiBetaConfig,
} from "./config.js";
import { formatGeminiBetaDoctorResult, runGeminiBetaDoctor } from "./doctor.js";
import { initGeminiBetaConfig } from "./init.js";
import { listManagedProcesses, stopManagedProcesses } from "./process-control.js";
import { startWorker } from "./start-worker.js";
import { updateLocalCheckout } from "./update.js";

import type { SpawnedForgeFlowCommand as WorkerCommand } from "./start-worker.js";
import type { GeminiBetaConfig } from "./types.js";

type SpawnedCommand = WorkerCommand;

export interface CliDeps {
  readConfig: typeof readGeminiBetaConfig;
  initConfig: typeof initGeminiBetaConfig;
  doctor: typeof runGeminiBetaDoctor;
  formatDoctor: typeof formatGeminiBetaDoctorResult;
  startWorkerCmd: typeof startWorker;
  listProcesses: typeof listManagedProcesses;
  stopProcesses: typeof stopManagedProcesses;
  updateCmd: typeof updateLocalCheckout;
  log: (message: string) => void;
}

export interface ParsedCliArgs {
  command: "init" | "doctor" | "start" | "status" | "stop" | "update" | "version" | "help";
  subcommand?: "worker";
  options: Record<string, string | number | boolean>;
}

function getMainHelpText(): string {
  return `forgeflow-gemini-beta - ForgeFlow Gemini Beta Runtime CLI

Usage: forgeflow-gemini-beta <command> [options]

Commands:
  init                          Initialize runtime configuration
  doctor                        Validate runtime prerequisites
  start worker                  Start gemini worker daemon
  status                        Show runtime and process status
  stop worker                   Stop gemini worker daemon
  update                        Update the runtime package to latest version
  version                       Print the package version

Options:
  -h, --help                    Show this help message
  --version                     Print the package version

Global Options:
  --json                        Output results as JSON
  --config-path <path>          Path to config file (default: ~/.forgeflow-gemini-beta/config.json)

Examples:
  forgeflow-gemini-beta init --repo-dir /path/to/repo
  forgeflow-gemini-beta doctor
  forgeflow-gemini-beta start worker --detach --log-file /tmp/gemini-worker.log
  forgeflow-gemini-beta status --json
  forgeflow-gemini-beta stop worker
  forgeflow-gemini-beta update
  forgeflow-gemini-beta --version

For more information on a command, run: forgeflow-gemini-beta <command> --help`;
}

function getStartHelpText(): string {
  return `forgeflow-gemini-beta start - Start gemini worker daemon

Usage: forgeflow-gemini-beta start worker [options]

Options:
  -h, --help                     Show this help message
  --detach                       Run in background (detached mode)
  --log-file <path>              Redirect output to log file
  --force                        Force start even if already running
  --once                         Run one loop and exit
  --dry-run-execution            Execute assignment in dry-run mode

Worker Options:
  --repo-dir <path>              Path to project repository
  --dispatcher-url <url>         Dispatcher server URL
  --worker-id <id>               Worker identifier
  --pool gemini                  Worker pool, fixed as gemini
  --gemini-bin <path>            Gemini CLI binary path
  --poll-interval-ms <ms>        Poll interval for dispatcher (default: 5000)

Examples:
  forgeflow-gemini-beta start worker --detach --log-file /tmp/gemini-worker.log
  forgeflow-gemini-beta start worker --repo-dir /path/to/repo --dispatcher-url http://127.0.0.1:8787 --worker-id gemini-remote`;
}

function getStopHelpText(): string {
  return `forgeflow-gemini-beta stop - Stop gemini worker daemon

Usage: forgeflow-gemini-beta stop worker [options]

Options:
  -h, --help                     Show this help message
  --json                         Output results as JSON

Examples:
  forgeflow-gemini-beta stop worker
  forgeflow-gemini-beta stop worker --json`;
}

function readPackageVersion() {
  const packageJsonPath = new URL("../package.json", import.meta.url);
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { version: string };
  return packageJson.version;
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
  const [command, maybeSubcommand, ...rest] = argv;
  if (!command) {
    throw new Error("command is required");
  }

  if (command === "--version" || command === "version") {
    return {
      command: "version",
      options: {},
    };
  }

  if (command === "--help" || command === "-h" || command === "help") {
    return {
      command: "help",
      options: {},
    };
  }

  const options: Record<string, string | number | boolean> = {};
  let subcommand: ParsedCliArgs["subcommand"];
  let args = rest;

  if (command === "start" || command === "stop") {
    if (maybeSubcommand === "--help" || maybeSubcommand === "-h" || maybeSubcommand === "help") {
      return {
        command: command as "start" | "stop",
        options: { help: true },
      };
    }
    if (!maybeSubcommand || maybeSubcommand !== "worker") {
      throw new Error(`${command} subcommand must be worker`);
    }
    subcommand = "worker";
  } else {
    args = [maybeSubcommand, ...rest].filter((value) => value !== undefined) as string[];
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      continue;
    }

    if (!arg.startsWith("--")) {
      throw new Error(`unknown argument: ${arg}`);
    }

    const key = arg.slice(2).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }
    options[key] = parseValue(next);
    index += 1;
  }

  if (!["init", "doctor", "start", "status", "stop", "update", "version"].includes(command)) {
    throw new Error(`unknown command: ${command}`);
  }

  return {
    command: command as ParsedCliArgs["command"],
    subcommand,
    options,
  };
}

function requireConfigValue<K extends keyof GeminiBetaConfig>(
  config: GeminiBetaConfig,
  key: K,
) {
  const value = config[key];
  if (value === undefined || value === null || value === "") {
    throw new Error(`config field ${String(key)} is required`);
  }
  return value;
}

function formatInitResultHuman(result: Awaited<ReturnType<typeof initGeminiBetaConfig>>): string {
  const lines: string[] = [];
  if (result.created) {
    lines.push(`Created config at ${result.configPath}`);
  } else {
    lines.push(`Config already exists at ${result.configPath}`);
  }
  if (result.config) {
    lines.push(`  repoDir: ${result.config.repoDir ?? "(not set)"}`);
    lines.push(`  dispatcherUrl: ${result.config.dispatcherUrl ?? "(not set)"}`);
    lines.push(`  workerId: ${result.config.workerId ?? "(not set)"}`);
    lines.push(`  pollIntervalMs: ${result.config.pollIntervalMs ?? "(not set)"}`);
    lines.push(`  geminiBin: ${result.config.geminiBin ?? "(not set)"}`);
    lines.push(`  pool: ${result.config.pool ?? "(not set)"}`);
  }
  return lines.join("\n");
}

function formatStatusResultHuman(result: {
  configPath?: string;
  configPresent: boolean;
  worker: ReturnType<typeof listManagedProcesses>;
}): string {
  const lines: string[] = [];
  lines.push(`Config: ${result.configPresent ? `present at ${result.configPath ?? "unknown path"}` : "not found"}`);
  lines.push("");
  lines.push("Worker:");
  if (result.worker.running) {
    lines.push("  Status: running");
    for (const match of result.worker.matches) {
      lines.push(`  PID ${match.pid}: ${match.command}`);
    }
  } else {
    lines.push("  Status: not running");
  }
  return lines.join("\n");
}

function formatStopResultHuman(result: ReturnType<typeof stopManagedProcesses>): string {
  if (result.stoppedPids.length === 0 && result.skippedPids.length === 0) {
    return "No managed worker process found.";
  }

  const lines = ["Stop worker result:"];
  lines.push(`  stopped: ${result.stoppedPids.length > 0 ? result.stoppedPids.join(", ") : "none"}`);
  lines.push(`  skipped: ${result.skippedPids.length > 0 ? result.skippedPids.join(", ") : "none"}`);
  return lines.join("\n");
}

function formatStartedCommand(command: SpawnedCommand): Record<string, unknown> {
  return {
    command: command.command,
    args: command.args,
    cwd: command.cwd,
    scriptPath: command.scriptPath,
    pid: command.child.pid || null,
  };
}

export async function runCli(
  argv: string[],
  overrides: Partial<CliDeps> = {},
): Promise<{ output: unknown; code: number; json: boolean }> {
  const deps: CliDeps = {
    readConfig: readGeminiBetaConfig,
    initConfig: initGeminiBetaConfig,
    doctor: runGeminiBetaDoctor,
    formatDoctor: formatGeminiBetaDoctorResult,
    startWorkerCmd: startWorker,
    listProcesses: listManagedProcesses,
    stopProcesses: stopManagedProcesses,
    updateCmd: updateLocalCheckout,
    log: (message: string) => {
      console.log(message);
    },
    ...overrides,
  };

  try {
    const parsed = parseCliArgs(argv);
    const jsonOutput = parsed.options.json === true;
    const configPath = typeof parsed.options.configPath === "string"
      ? String(parsed.options.configPath)
      : undefined;

    if (parsed.command === "help") {
      return {
        output: getMainHelpText(),
        code: 0,
        json: false,
      };
    }

    if (parsed.command === "version") {
      return {
        output: readPackageVersion(),
        code: 0,
        json: false,
      };
    }

    if (parsed.command === "init") {
      const result = deps.initConfig({
        configPath,
        repoDir: typeof parsed.options.repoDir === "string" ? parsed.options.repoDir : undefined,
        dispatcherUrl: typeof parsed.options.dispatcherUrl === "string" ? parsed.options.dispatcherUrl : undefined,
        workerId: typeof parsed.options.workerId === "string" ? parsed.options.workerId : undefined,
        pollIntervalMs: typeof parsed.options.pollIntervalMs === "number" ? parsed.options.pollIntervalMs : undefined,
        geminiBin: typeof parsed.options.geminiBin === "string" ? parsed.options.geminiBin : undefined,
        overwrite: parsed.options.overwrite === true,
      });

      return {
        output: jsonOutput ? result : formatInitResultHuman(result),
        code: 0,
        json: jsonOutput,
      };
    }

    if (parsed.command === "doctor") {
      const result = deps.doctor({ configPath });
      return {
        output: jsonOutput ? result : deps.formatDoctor(result),
        code: result.ok ? 0 : 1,
        json: jsonOutput,
      };
    }

    if (parsed.command === "start") {
      if (parsed.options.help === true) {
        return {
          output: getStartHelpText(),
          code: 0,
          json: false,
        };
      }

      const config = deps.readConfig({ configPath });
      if (!config) {
        throw new Error("config is required. Run `forgeflow-gemini-beta init` first.");
      }

      const command = deps.startWorkerCmd({
        repoDir: typeof parsed.options.repoDir === "string" ? parsed.options.repoDir : requireConfigValue(config, "repoDir"),
        dispatcherUrl: typeof parsed.options.dispatcherUrl === "string" ? parsed.options.dispatcherUrl : requireConfigValue(config, "dispatcherUrl"),
        workerId: typeof parsed.options.workerId === "string" ? parsed.options.workerId : requireConfigValue(config, "workerId"),
        pool: "gemini",
        geminiBin: typeof parsed.options.geminiBin === "string" ? parsed.options.geminiBin : requireConfigValue(config, "geminiBin"),
        pollIntervalMs: typeof parsed.options.pollIntervalMs === "number" ? parsed.options.pollIntervalMs : requireConfigValue(config, "pollIntervalMs"),
        dryRunExecution: parsed.options.dryRunExecution === true,
        once: parsed.options.once === true,
        force: parsed.options.force === true,
        detached: parsed.options.detach === true,
        logFile: typeof parsed.options.logFile === "string" ? parsed.options.logFile : undefined,
      });

      await command.ready;

      return {
        output: jsonOutput
          ? {
              ok: true,
              started: formatStartedCommand(command),
            }
          : `Started worker\n${JSON.stringify(formatStartedCommand(command), null, 2)}`,
        code: 0,
        json: jsonOutput,
      };
    }

    if (parsed.command === "status") {
      const config = deps.readConfig({ configPath });
      const worker = deps.listProcesses("worker");
      const result = {
        configPath,
        configPresent: Boolean(config),
        config,
        worker,
      };
      return {
        output: jsonOutput ? result : formatStatusResultHuman(result),
        code: 0,
        json: jsonOutput,
      };
    }

    if (parsed.command === "stop") {
      if (parsed.options.help === true) {
        return {
          output: getStopHelpText(),
          code: 0,
          json: false,
        };
      }

      const result = deps.stopProcesses("worker");
      return {
        output: jsonOutput ? result : formatStopResultHuman(result),
        code: 0,
        json: jsonOutput,
      };
    }

    if (parsed.command === "update") {
      const result = await deps.updateCmd();
      return {
        output: jsonOutput ? result : `${result.message}\n${result.performedCommand}`,
        code: 0,
        json: jsonOutput,
      };
    }

    throw new Error(`unsupported command: ${parsed.command}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      output: { error: message },
      code: 1,
      json: true,
    };
  }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const result = await runCli(argv);

  if (result.json) {
    process.stdout.write(`${JSON.stringify(result.output, null, 2)}\n`);
  } else if (typeof result.output === "string") {
    process.stdout.write(`${result.output}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(result.output, null, 2)}\n`);
  }

  if (result.code !== 0) {
    process.exitCode = result.code;
  }
}

export function isCliEntrypoint(
  importMetaUrl: string,
  argv1 = process.argv[1],
  realpathSync: (targetPath: string) => string = fs.realpathSync.native ?? fs.realpathSync,
) {
  if (!argv1) {
    return false;
  }

  try {
    return pathToFileURL(realpathSync(argv1)).href === importMetaUrl;
  } catch {
    return pathToFileURL(argv1).href === importMetaUrl;
  }
}

if (isCliEntrypoint(import.meta.url)) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
