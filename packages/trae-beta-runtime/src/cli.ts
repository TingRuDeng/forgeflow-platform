#!/usr/bin/env node

import fs from "node:fs";
import { pathToFileURL } from "node:url";

import {
  readTraeBetaConfig,
} from "./config.js";
import { formatTraeBetaDoctorResult, runTraeBetaDoctor } from "./doctor.js";
import { initTraeBetaConfig } from "./init.js";
import { listManagedProcesses, stopManagedProcesses, stopLaunch } from "./process-control.js";
import { startLaunch } from "./start-launch.js";
import { startGateway } from "./start-gateway.js";
import { startWorker } from "./start-worker.js";
import { updateLocalCheckout } from "./update.js";

import type { SpawnedForgeFlowCommand as LaunchCommand } from "./start-launch.js";
import type { SpawnedForgeFlowCommand as GatewayCommand } from "./start-gateway.js";
import type { SpawnedForgeFlowCommand as WorkerCommand } from "./start-worker.js";
import type { TraeBetaConfig } from "./types.js";

type SpawnedCommand = LaunchCommand | GatewayCommand | WorkerCommand;

export interface CliDeps {
  readConfig: typeof readTraeBetaConfig;
  initConfig: typeof initTraeBetaConfig;
  doctor: typeof runTraeBetaDoctor;
  formatDoctor: typeof formatTraeBetaDoctorResult;
  startLaunchCmd: typeof startLaunch;
  startGatewayCmd: typeof startGateway;
  startWorkerCmd: typeof startWorker;
  listProcesses: typeof listManagedProcesses;
  stopProcesses: typeof stopManagedProcesses;
  stopLaunchCmd: typeof stopLaunch;
  updateCmd: typeof updateLocalCheckout;
  waitForRemoteDebuggingReady: (input: { remoteDebuggingPort: number }) => Promise<void>;
  waitForAutomationReady: (input: { automationUrl: string }) => Promise<void>;
  waitForDispatcherHealth: (input: { dispatcherUrl: string }) => Promise<void>;
  log: (message: string) => void;
}

export interface ParsedCliArgs {
  command: "init" | "doctor" | "restart" | "start" | "status" | "stop" | "update" | "version" | "help";
  subcommand?: "all" | "launch" | "gateway" | "worker";
  options: Record<string, string | number | boolean>;
}

function getMainHelpText(): string {
  return `forgeflow-trae-beta - ForgeFlow Trae Beta Runtime CLI

Usage: forgeflow-trae-beta <command> [options]

Commands:
  init                          Initialize runtime configuration
  doctor                        Validate runtime prerequisites
  start <subcommand>            Start a runtime component (launch|gateway|worker|all)
  status                        Show runtime and process status
  stop <subcommand>             Stop a runtime component (launch|gateway|worker|all)
  restart <subcommand>          Restart a runtime component (launch|gateway|worker|all)
  update                        Update the runtime package to latest version
  version                       Print the package version

Options:
  -h, --help                    Show this help message
  --version                     Print the package version

Global Options:
  --json                        Output results as JSON
  --config-path <path>          Path to config file (default: ~/.forgeflow-trae-beta/config.json)

Examples:
  forgeflow-trae-beta init --project-path /path/to/repo
  forgeflow-trae-beta doctor
  forgeflow-trae-beta start launch --detach
  forgeflow-trae-beta start gateway --detach --log-file /tmp/gateway.log
  forgeflow-trae-beta start worker --detach --log-file /tmp/worker.log
  forgeflow-trae-beta start all --detach --log-file-dir /tmp/forgeflow-logs
  forgeflow-trae-beta status --json
  forgeflow-trae-beta stop all
  forgeflow-trae-beta restart launch
  forgeflow-trae-beta restart gateway
  forgeflow-trae-beta restart worker
  forgeflow-trae-beta restart all --detach --log-file-dir /tmp/forgeflow-logs
  forgeflow-trae-beta update
  forgeflow-trae-beta --version

For more information on a command, run: forgeflow-trae-beta <command> --help`;
}

function getStartHelpText(): string {
  return `forgeflow-trae-beta start - Start a runtime component

Usage: forgeflow-trae-beta start <subcommand> [options]

Subcommands:
  launch                         Launch Trae with remote debugging enabled
  gateway                        Start the local automation gateway
  worker                         Start the unattended Trae worker
  all                            Start launch, gateway, and worker (in order: launch -> gateway -> worker)

Options:
  -h, --help                     Show this help message
  --detach                       Run in background (detached mode)
  --log-file <path>              Redirect output to log file (single service only)
  --log-file-dir <dir>           Directory for log files (for 'all' subcommand)
  --force                        Force start even if already running

Launch Options:
  --trae-bin <path>              Path to Trae binary
  --project-path <path>          Path to project repository
  --remote-debugging-port <port> Remote debugging port
  --timeout-ms <ms>             Launch timeout in milliseconds

Gateway Options:
  --host <host>                  Gateway bind host (default: from automationUrl)
  --port <port>                  Gateway bind port (default: from automationUrl)

Worker Options:
  --repo-dir <path>              Path to project repository
  --dispatcher-url <url>         Dispatcher server URL
  --automation-url <url>         Automation gateway URL
  --worker-id <id>               Worker identifier
  --poll-interval-ms <ms>        Poll interval for dispatcher (default: 5000)
  --once                         Run worker once and exit

Gateway/Worker/All Options:
  --debug                        Enable verbose debug logs for gateway and worker runtime

Examples:
  forgeflow-trae-beta start launch --detach
  forgeflow-trae-beta start gateway --detach --log-file /tmp/gateway.log
  forgeflow-trae-beta start worker --detach --log-file /tmp/worker.log
  forgeflow-trae-beta start worker --once --force`;
}

function getStopHelpText(): string {
  return `forgeflow-trae-beta stop - Stop a runtime component

Usage: forgeflow-trae-beta stop <subcommand> [options]

Subcommands:
  launch                         Stop the Trae launch (closes Trae)
  gateway                        Stop the local automation gateway
  worker                         Stop the unattended Trae worker
  all                            Stop worker and gateway (in order: worker -> gateway)

Options:
  -h, --help                     Show this help message
  --json                         Output results as JSON

Examples:
  forgeflow-trae-beta stop launch
  forgeflow-trae-beta stop gateway
  forgeflow-trae-beta stop worker
  forgeflow-trae-beta stop all
  forgeflow-trae-beta stop gateway --json`;
}

function getRestartHelpText(): string {
  return `forgeflow-trae-beta restart - Restart a runtime component

Usage: forgeflow-trae-beta restart <subcommand> [options]

Subcommands:
  launch                         Restart launch (true restart: stop then start)
  gateway                        Restart gateway (true restart: stop then start)
  worker                         Restart worker (true restart: stop then start)
  all                            Restart all (stop worker, gateway, launch; then start launch, gateway, worker)

Options:
  -h, --help                     Show this help message
  --detach                       Run in background (detached mode) after restart
  --log-file <path>              Redirect output to log file (single service only)
  --log-file-dir <dir>           Directory for log files (for 'all' subcommand)
  --debug                        Enable verbose debug logs for gateway and worker runtime

Examples:
  forgeflow-trae-beta restart launch --log-file /tmp/launch.log
  forgeflow-trae-beta restart gateway --log-file /tmp/gateway.log
  forgeflow-trae-beta restart worker --log-file /tmp/worker.log
  forgeflow-trae-beta restart all --detach --debug --log-file-dir /tmp/forgeflow-logs`;
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

  if (command === "start" || command === "stop" || command === "restart") {
    if (maybeSubcommand === "--help" || maybeSubcommand === "-h" || maybeSubcommand === "help") {
      return {
        command: command as "start" | "stop" | "restart",
        options: { help: true },
      };
    }
    if (!maybeSubcommand || !["launch", "gateway", "worker", "all"].includes(maybeSubcommand)) {
      throw new Error(`${command} subcommand must be one of: launch, gateway, worker, all`);
    }
    subcommand = maybeSubcommand as ParsedCliArgs["subcommand"];
  } else {
    args = [maybeSubcommand, ...rest].filter((value) => value !== undefined) as string[];
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      continue;
    }

    if (arg === "-d") {
      options.detach = true;
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

  if (!["init", "doctor", "restart", "start", "status", "stop", "update", "version"].includes(command)) {
    throw new Error(`unknown command: ${command}`);
  }

  return {
    command: command as ParsedCliArgs["command"],
    subcommand,
    options,
  };
}

function requireConfigValue<K extends keyof TraeBetaConfig>(
  config: TraeBetaConfig,
  key: K,
) {
  const value = config[key];
  if (value === undefined || value === null || value === "") {
    throw new Error(`config field ${String(key)} is required`);
  }
  return value;
}

function formatInitResultHuman(result: Awaited<ReturnType<typeof initTraeBetaConfig>>): string {
  const lines: string[] = [];
  if (result.created) {
    lines.push(`Created config at ${result.configPath}`);
  } else {
    lines.push(`Config already exists at ${result.configPath}`);
  }
  if (result.config) {
    lines.push(`  projectPath: ${result.config.projectPath ?? "(not set)"}`);
    lines.push(`  dispatcherUrl: ${result.config.dispatcherUrl ?? "(not set)"}`);
    lines.push(`  automationUrl: ${result.config.automationUrl ?? "(not set)"}`);
    lines.push(`  workerId: ${result.config.workerId ?? "(not set)"}`);
    lines.push(`  traeBin: ${result.config.traeBin ?? "(not set)"}`);
    lines.push(`  remoteDebuggingPort: ${result.config.remoteDebuggingPort ?? "(not set)"}`);
  }
  return lines.join("\n");
}

function formatStatusResultHuman(result: {
  configPath?: string;
  configPresent: boolean;
  gateway: ReturnType<typeof listManagedProcesses>;
  worker: ReturnType<typeof listManagedProcesses>;
}): string {
  const lines: string[] = [];
  lines.push(`Config: ${result.configPresent ? `present at ${result.configPath ?? "unknown path"}` : "not found"}`);
  lines.push("");
  lines.push("Gateway:");
  if (result.gateway.running) {
    lines.push("  Status: running");
    for (const match of result.gateway.matches) {
      lines.push(`  PID ${match.pid}: ${match.command}`);
    }
  } else {
    lines.push("  Status: not running");
  }
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
  const lines: string[] = [];
  lines.push(`Stopped ${result.kind}:`);
  if (result.stoppedPids.length > 0) {
    for (const pid of result.stoppedPids) {
      lines.push(`  PID ${pid}: stopped`);
    }
  }
  if (result.skippedPids.length > 0) {
    for (const pid of result.skippedPids) {
      lines.push(`  PID ${pid}: skipped (already stopped or not found)`);
    }
  }
  if (result.stoppedPids.length === 0 && result.skippedPids.length === 0) {
    lines.push("  No processes found");
  }
  return lines.join("\n");
}

function formatUpdateResultHuman(result: Awaited<ReturnType<typeof updateLocalCheckout>>): string {
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
  return lines.join("\n");
}

function formatSpawnedCommandHuman(result: SpawnedCommand, kind: "launch" | "gateway" | "worker"): string {
  const lines: string[] = [];
  lines.push(`Started ${kind}:`);
  lines.push(`  Command: ${result.command}`);
  lines.push(`  Script: ${result.scriptPath}`);
  lines.push(`  Working directory: ${result.cwd}`);
  lines.push(`  PID: ${result.child.pid ?? "unknown"}`);
  return lines.join("\n");
}

function formatSpawnedCommandJson(result: SpawnedCommand) {
  return JSON.stringify({
    command: result.command,
    args: result.args,
    cwd: result.cwd,
    scriptPath: result.scriptPath,
    pid: result.child.pid ?? null,
  }, null, 2);
}

function resolveGatewayBindFromAutomationUrl(config: TraeBetaConfig) {
  const parsed = new URL(config.automationUrl);
  const port = parsed.port
    ? Number(parsed.port)
    : parsed.protocol === "https:"
      ? 443
      : 80;

  return {
    host: parsed.hostname,
    port,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withPath(baseUrl: string, pathname: string): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(pathname, normalizedBase).toString();
}

async function fetchJsonWithTimeout(url: string, timeoutMs: number): Promise<{ statusCode: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
      },
    });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }

    return {
      statusCode: response.status,
      body,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function waitForReadiness(
  label: string,
  probe: () => Promise<void>,
  options: {
    maxAttempts?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
  } = {},
): Promise<void> {
  const maxAttempts = options.maxAttempts ?? 20;
  let delayMs = options.initialDelayMs ?? 300;
  const maxDelayMs = options.maxDelayMs ?? 2_000;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await probe();
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt >= maxAttempts) {
        break;
      }
      await sleep(delayMs);
      delayMs = Math.min(maxDelayMs, Math.round(delayMs * 1.5));
    }
  }

  throw new Error(`${label} is not ready: ${lastError?.message || "unknown error"}`);
}

async function waitForRemoteDebuggingReady(input: { remoteDebuggingPort: number }): Promise<void> {
  const url = `http://127.0.0.1:${input.remoteDebuggingPort}/json/version`;
  await waitForReadiness("Trae remote debugging endpoint", async () => {
    const { statusCode, body } = await fetchJsonWithTimeout(url, 2_000);
    const parsed = body as Record<string, unknown> | null;
    if (
      statusCode !== 200
      || !parsed
      || typeof parsed !== "object"
      || typeof parsed.webSocketDebuggerUrl !== "string"
      || parsed.webSocketDebuggerUrl.length === 0
    ) {
      throw new Error(`unexpected response from ${url}`);
    }
  });
}

async function waitForAutomationReady(input: { automationUrl: string }): Promise<void> {
  const url = withPath(input.automationUrl, "/ready");
  await waitForReadiness("automation gateway /ready", async () => {
    const { statusCode, body } = await fetchJsonWithTimeout(url, 2_000);
    const parsed = body as Record<string, unknown> | null;
    const data = parsed && typeof parsed.data === "object" && parsed.data !== null
      ? parsed.data as Record<string, unknown>
      : null;
    const ready = data?.ready === true || parsed?.ready === true;
    if (statusCode !== 200 || !ready) {
      throw new Error(`unexpected response from ${url}`);
    }
  });
}

async function waitForDispatcherHealth(input: { dispatcherUrl: string }): Promise<void> {
  const url = withPath(input.dispatcherUrl, "/health");
  await waitForReadiness("dispatcher /health", async () => {
    const { statusCode, body } = await fetchJsonWithTimeout(url, 2_000);
    const parsed = body as Record<string, unknown> | null;
    if (statusCode !== 200 || !parsed || parsed.status !== "ok") {
      throw new Error(`unexpected response from ${url}`);
    }
  });
}

export async function runCli(argv: string[], partialDeps: Partial<CliDeps> = {}) {
  const deps: CliDeps = {
    readConfig: readTraeBetaConfig,
    initConfig: initTraeBetaConfig,
    doctor: runTraeBetaDoctor,
    formatDoctor: formatTraeBetaDoctorResult,
    startLaunchCmd: startLaunch,
    startGatewayCmd: startGateway,
    startWorkerCmd: startWorker,
    listProcesses: listManagedProcesses,
    stopProcesses: stopManagedProcesses,
    stopLaunchCmd: stopLaunch,
    updateCmd: updateLocalCheckout,
    waitForRemoteDebuggingReady,
    waitForAutomationReady,
    waitForDispatcherHealth,
    log: (message) => console.log(message),
    ...partialDeps,
  };

  const parsed = parseCliArgs(argv);

  if (parsed.command === "help") {
    deps.log(getMainHelpText());
    return;
  }

  if (parsed.command === "start" && parsed.options.help === true) {
    deps.log(getStartHelpText());
    return;
  }

  if (parsed.command === "stop" && parsed.options.help === true) {
    deps.log(getStopHelpText());
    return;
  }

  if (parsed.command === "restart" && parsed.options.help === true) {
    deps.log(getRestartHelpText());
    return;
  }

  const configPath = typeof parsed.options.configPath === "string" ? parsed.options.configPath : undefined;
  const config = deps.readConfig({ configPath });
  const jsonOutput = parsed.options.json === true;
  const logProgress = (message: string) => {
    if (!jsonOutput) {
      deps.log(message);
    }
  };

  if (parsed.command === "init") {
    const result = deps.initConfig({
      configPath,
      cwd: typeof parsed.options.cwd === "string" ? parsed.options.cwd : undefined,
      overwrite: parsed.options.overwrite === true,
      projectPath: typeof parsed.options.projectPath === "string" ? parsed.options.projectPath : undefined,
      dispatcherUrl: typeof parsed.options.dispatcherUrl === "string" ? parsed.options.dispatcherUrl : undefined,
      dispatcherToken: typeof parsed.options.token === "string" ? parsed.options.token : undefined,
      automationUrl: typeof parsed.options.automationUrl === "string" ? parsed.options.automationUrl : undefined,
      workerId: typeof parsed.options.workerId === "string" ? parsed.options.workerId : undefined,
      traeBin: typeof parsed.options.traeBin === "string" ? parsed.options.traeBin : undefined,
      remoteDebuggingPort: typeof parsed.options.remoteDebuggingPort === "number" ? parsed.options.remoteDebuggingPort : undefined,
    });
    if (jsonOutput) {
      deps.log(JSON.stringify(result, null, 2));
    } else {
      deps.log(formatInitResultHuman(result));
    }
    return result;
  }

  if (parsed.command === "doctor") {
    const result = deps.doctor({ configPath, config: config || undefined });
    deps.log(deps.formatDoctor(result));
    return result;
  }

  if (parsed.command === "status") {
    const result = {
      configPath,
      configPresent: Boolean(config),
      gateway: deps.listProcesses("gateway"),
      worker: deps.listProcesses("worker"),
    };
    if (jsonOutput) {
      deps.log(JSON.stringify(result));
    } else {
      deps.log(formatStatusResultHuman(result));
    }
    return result;
  }

  if (parsed.command === "version") {
    const version = readPackageVersion();
    deps.log(version);
    return version;
  }

  if (parsed.command === "update") {
    const result = await deps.updateCmd({
      defaultBranch: typeof parsed.options.defaultBranch === "string" ? parsed.options.defaultBranch : "latest",
    });
    if (jsonOutput) {
      deps.log(JSON.stringify(result, null, 2));
    } else {
      deps.log(formatUpdateResultHuman(result));
    }
    return result;
  }

  if (parsed.command === "stop") {
    if (!parsed.subcommand || !["launch", "gateway", "worker", "all"].includes(parsed.subcommand)) {
      throw new Error("stop subcommand must be one of: launch, gateway, worker, all");
    }

    const results: {
      launch?: { stoppedPids: number[]; skippedPids: number[] };
      gateway?: { stoppedPids: number[]; skippedPids: number[] };
      worker?: { stoppedPids: number[]; skippedPids: number[] };
    } = {};

    if (parsed.subcommand === "all") {
      const workerResult = deps.stopProcesses("worker");
      results.worker = { stoppedPids: workerResult.stoppedPids, skippedPids: workerResult.skippedPids };
      const gatewayResult = deps.stopProcesses("gateway");
      results.gateway = { stoppedPids: gatewayResult.stoppedPids, skippedPids: gatewayResult.skippedPids };
    } else if (parsed.subcommand === "launch") {
      const launchResult = deps.stopLaunchCmd();
      results.launch = { stoppedPids: launchResult.stoppedPids, skippedPids: launchResult.skippedPids };
    } else if (parsed.subcommand === "gateway") {
      const gatewayResult = deps.stopProcesses("gateway");
      results.gateway = { stoppedPids: gatewayResult.stoppedPids, skippedPids: gatewayResult.skippedPids };
    } else if (parsed.subcommand === "worker") {
      const workerResult = deps.stopProcesses("worker");
      results.worker = { stoppedPids: workerResult.stoppedPids, skippedPids: workerResult.skippedPids };
    }

    if (jsonOutput) {
      deps.log(JSON.stringify(results, null, 2));
    } else {
      const lines: string[] = [];
      for (const [kind, result] of Object.entries(results)) {
        if (!result) continue;
        const stopped = result.stoppedPids.length;
        const skipped = result.skippedPids.length;
        lines.push(`${kind}: stopped ${stopped} process(es)${skipped > 0 ? `, skipped ${skipped}` : ""}`);
      }
      deps.log(lines.join("\n") || "No actions taken");
    }
    return results;
  }

  if (parsed.command === "restart") {
    if (!config) {
      throw new Error("config file is required before running restart commands; run init first");
    }

    if (parsed.subcommand === "launch") {
      const stoppedResult = deps.stopLaunchCmd();
      const result = deps.startLaunchCmd({
        traeBin: requireConfigValue(config, "traeBin"),
        projectPath: requireConfigValue(config, "projectPath"),
        remoteDebuggingPort: requireConfigValue(config, "remoteDebuggingPort"),
        timeoutMs: typeof parsed.options.timeoutMs === "number" ? parsed.options.timeoutMs : undefined,
        ...(parsed.options.detach === true && { detached: true }),
        ...(typeof parsed.options.logFile === "string" && { logFile: parsed.options.logFile }),
      });
      await result.ready;
      if (jsonOutput) {
        deps.log(JSON.stringify({ stopped: stoppedResult, started: result }, null, 2));
      } else {
        deps.log(`launch: stopped ${stoppedResult.stoppedPids.length} process(es)`);
        deps.log(formatSpawnedCommandHuman(result, "launch"));
      }
      return { stopped: stoppedResult, started: result };
    }

    if (parsed.subcommand === "gateway") {
      const stoppedResult = deps.stopProcesses("gateway");
      const gatewayBind = resolveGatewayBindFromAutomationUrl(config);
      const result = deps.startGatewayCmd({
        host: typeof parsed.options.host === "string" ? parsed.options.host : gatewayBind.host,
        port: typeof parsed.options.port === "number" ? parsed.options.port : gatewayBind.port,
        ...(parsed.options.debug === true && { debug: true }),
        force: true,
        ...(parsed.options.detach === true && { detached: true }),
        ...(typeof parsed.options.logFile === "string" && { logFile: parsed.options.logFile }),
      });
      await result.ready;
      if (jsonOutput) {
        deps.log(JSON.stringify({ stopped: stoppedResult, started: result }, null, 2));
      } else {
        deps.log(`gateway: stopped ${stoppedResult.stoppedPids.length} process(es)`);
        deps.log(formatSpawnedCommandHuman(result, "gateway"));
      }
      return { stopped: stoppedResult, started: result };
    }

    if (parsed.subcommand === "worker") {
      const stoppedResult = deps.stopProcesses("worker");
      const result = deps.startWorkerCmd({
        repoDir: requireConfigValue(config, "projectPath"),
        dispatcherUrl: requireConfigValue(config, "dispatcherUrl"),
        automationUrl: requireConfigValue(config, "automationUrl"),
        workerId: requireConfigValue(config, "workerId"),
        ...(parsed.options.debug === true && { debug: true }),
        pollIntervalMs: typeof parsed.options.pollIntervalMs === "number" ? parsed.options.pollIntervalMs : undefined,
        force: true,
        ...(parsed.options.detach === true && { detached: true }),
        ...(typeof parsed.options.logFile === "string" && { logFile: parsed.options.logFile }),
      });
      await result.ready;
      if (jsonOutput) {
        deps.log(JSON.stringify({ stopped: stoppedResult, started: result }, null, 2));
      } else {
        deps.log(`worker: stopped ${stoppedResult.stoppedPids.length} process(es)`);
        deps.log(formatSpawnedCommandHuman(result, "worker"));
      }
      return { stopped: stoppedResult, started: result };
    }

    if (parsed.subcommand === "all") {
      const logFileDir = typeof parsed.options.logFileDir === "string"
        ? parsed.options.logFileDir
        : "/tmp/forgeflow-trae-beta-logs";
      const projectPath = requireConfigValue(config, "projectPath");
      const dispatcherUrl = requireConfigValue(config, "dispatcherUrl");
      const automationUrl = requireConfigValue(config, "automationUrl");
      const workerId = requireConfigValue(config, "workerId");
      const traeBin = requireConfigValue(config, "traeBin");
      const remoteDebuggingPort = requireConfigValue(config, "remoteDebuggingPort");

      fs.mkdirSync(logFileDir, { recursive: true });

      const stoppedWorkerResult = deps.stopProcesses("worker");
      const stoppedGatewayResult = deps.stopProcesses("gateway");
      const stoppedLaunchResult = deps.stopLaunchCmd();
      logProgress(`worker: stopped ${stoppedWorkerResult.stoppedPids.length} process(es)`);
      logProgress(`gateway: stopped ${stoppedGatewayResult.stoppedPids.length} process(es)`);
      logProgress(`launch: stopped ${stoppedLaunchResult.stoppedPids.length} process(es)`);

      logProgress("launch: starting...");
      const startLaunchResult = deps.startLaunchCmd({
        traeBin,
        projectPath,
        remoteDebuggingPort,
        timeoutMs: typeof parsed.options.timeoutMs === "number" ? parsed.options.timeoutMs : undefined,
        ...(parsed.options.detach === true && { detached: true }),
        logFile: `${logFileDir}/launch.log`,
      });
      await startLaunchResult.ready;
      logProgress(formatSpawnedCommandHuman(startLaunchResult, "launch"));
      logProgress("launch: waiting for remote debugging endpoint...");
      await deps.waitForRemoteDebuggingReady({ remoteDebuggingPort });
      logProgress("launch: remote debugging endpoint ready");

      const gatewayBind = resolveGatewayBindFromAutomationUrl(config);
      logProgress("gateway: starting...");
      const startGatewayResult = deps.startGatewayCmd({
        host: typeof parsed.options.host === "string" ? parsed.options.host : gatewayBind.host,
        port: typeof parsed.options.port === "number" ? parsed.options.port : gatewayBind.port,
        ...(parsed.options.debug === true && { debug: true }),
        force: true,
        ...(parsed.options.detach === true && { detached: true }),
        logFile: `${logFileDir}/gateway.log`,
      });
      await startGatewayResult.ready;
      logProgress(formatSpawnedCommandHuman(startGatewayResult, "gateway"));
      logProgress("gateway: waiting for automation gateway /ready...");
      await deps.waitForAutomationReady({ automationUrl });
      logProgress("gateway: automation gateway ready");
      logProgress("dispatcher: waiting for /health...");
      await deps.waitForDispatcherHealth({ dispatcherUrl });
      logProgress("dispatcher: /health reported ok");

      logProgress("worker: starting...");
      const startWorkerResult = deps.startWorkerCmd({
        repoDir: projectPath,
        dispatcherUrl,
        automationUrl,
        workerId,
        ...(parsed.options.debug === true && { debug: true }),
        pollIntervalMs: typeof parsed.options.pollIntervalMs === "number" ? parsed.options.pollIntervalMs : undefined,
        force: true,
        ...(parsed.options.detach === true && { detached: true }),
        logFile: `${logFileDir}/worker.log`,
      });
      await startWorkerResult.ready;
      logProgress(formatSpawnedCommandHuman(startWorkerResult, "worker"));
      logProgress("all: runtime restart complete");

      const results = {
        stopped: {
          worker: stoppedWorkerResult,
          gateway: stoppedGatewayResult,
          launch: stoppedLaunchResult,
        },
        started: {
          launch: startLaunchResult,
          gateway: startGatewayResult,
          worker: startWorkerResult,
        },
      };

      if (jsonOutput) {
        deps.log(JSON.stringify(results, null, 2));
      }
      return results;
    }
  }

  if (!config) {
    throw new Error("config file is required before running start commands; run init first");
  }

  if (parsed.subcommand === "launch") {
    const result = deps.startLaunchCmd({
      traeBin:
        (typeof parsed.options.traeBin === "string" ? parsed.options.traeBin : undefined)
        || requireConfigValue(config, "traeBin"),
      projectPath:
        (typeof parsed.options.projectPath === "string" ? parsed.options.projectPath : undefined)
        || requireConfigValue(config, "projectPath"),
      remoteDebuggingPort:
        (typeof parsed.options.remoteDebuggingPort === "number" ? parsed.options.remoteDebuggingPort : undefined)
        || requireConfigValue(config, "remoteDebuggingPort"),
      timeoutMs: typeof parsed.options.timeoutMs === "number" ? parsed.options.timeoutMs : undefined,
      ...(parsed.options.detach === true && { detached: true }),
      ...(typeof parsed.options.logFile === "string" && { logFile: parsed.options.logFile }),
    });
    await result.ready;
    if (jsonOutput) {
      deps.log(formatSpawnedCommandJson(result));
    } else {
      deps.log(formatSpawnedCommandHuman(result, "launch"));
    }
    return result;
  }

  if (parsed.subcommand === "gateway") {
    const gatewayBind = resolveGatewayBindFromAutomationUrl(config);
    const result = deps.startGatewayCmd({
      host: typeof parsed.options.host === "string" ? parsed.options.host : gatewayBind.host,
      port: typeof parsed.options.port === "number" ? parsed.options.port : gatewayBind.port,
      ...(parsed.options.debug === true && { debug: true }),
      force: parsed.options.force === true,
      ...(parsed.options.detach === true && { detached: true }),
      ...(typeof parsed.options.logFile === "string" && { logFile: parsed.options.logFile }),
    });
    await result.ready;
    if (jsonOutput) {
      deps.log(formatSpawnedCommandJson(result));
    } else {
      deps.log(formatSpawnedCommandHuman(result, "gateway"));
    }
    return result;
  }

  if (parsed.subcommand === "worker") {
    const result = deps.startWorkerCmd({
      repoDir:
        (typeof parsed.options.repoDir === "string" ? parsed.options.repoDir : undefined)
        || requireConfigValue(config, "projectPath"),
      dispatcherUrl:
        (typeof parsed.options.dispatcherUrl === "string" ? parsed.options.dispatcherUrl : undefined)
        || requireConfigValue(config, "dispatcherUrl"),
      automationUrl:
        (typeof parsed.options.automationUrl === "string" ? parsed.options.automationUrl : undefined)
        || requireConfigValue(config, "automationUrl"),
      workerId:
        (typeof parsed.options.workerId === "string" ? parsed.options.workerId : undefined)
        || requireConfigValue(config, "workerId"),
      ...(parsed.options.debug === true && { debug: true }),
      traeBin:
        (typeof parsed.options.traeBin === "string" ? parsed.options.traeBin : undefined)
        || requireConfigValue(config, "traeBin"),
      remoteDebuggingPort:
        (typeof parsed.options.remoteDebuggingPort === "number" ? parsed.options.remoteDebuggingPort : undefined)
        || requireConfigValue(config, "remoteDebuggingPort"),
      pollIntervalMs: typeof parsed.options.pollIntervalMs === "number" ? parsed.options.pollIntervalMs : undefined,
      ...(parsed.options.once === true && { once: true }),
      force: parsed.options.force === true,
      ...(parsed.options.detach === true && { detached: true }),
      ...(typeof parsed.options.logFile === "string" && { logFile: parsed.options.logFile }),
    });
    await result.ready;
    if (jsonOutput) {
      deps.log(formatSpawnedCommandJson(result));
    } else {
      deps.log(formatSpawnedCommandHuman(result, "worker"));
    }
    return result;
  }

  if (parsed.subcommand === "all") {
    const logFileDir = typeof parsed.options.logFileDir === "string"
      ? parsed.options.logFileDir
      : "/tmp/forgeflow-trae-beta-logs";
    const projectPath =
      (typeof parsed.options.projectPath === "string" ? parsed.options.projectPath : undefined)
      || requireConfigValue(config, "projectPath");
    const dispatcherUrl =
      (typeof parsed.options.dispatcherUrl === "string" ? parsed.options.dispatcherUrl : undefined)
      || requireConfigValue(config, "dispatcherUrl");
    const automationUrl =
      (typeof parsed.options.automationUrl === "string" ? parsed.options.automationUrl : undefined)
      || requireConfigValue(config, "automationUrl");
    const workerId =
      (typeof parsed.options.workerId === "string" ? parsed.options.workerId : undefined)
      || requireConfigValue(config, "workerId");
    const traeBin =
      (typeof parsed.options.traeBin === "string" ? parsed.options.traeBin : undefined)
      || requireConfigValue(config, "traeBin");
    const remoteDebuggingPort =
      (typeof parsed.options.remoteDebuggingPort === "number" ? parsed.options.remoteDebuggingPort : undefined)
      || requireConfigValue(config, "remoteDebuggingPort");

    fs.mkdirSync(logFileDir, { recursive: true });

    logProgress("launch: starting...");
    const startLaunchResult = deps.startLaunchCmd({
      traeBin,
      projectPath,
      remoteDebuggingPort,
      timeoutMs: typeof parsed.options.timeoutMs === "number" ? parsed.options.timeoutMs : undefined,
      ...(parsed.options.detach === true && { detached: true }),
      logFile: `${logFileDir}/launch.log`,
    });
    await startLaunchResult.ready;
    logProgress(formatSpawnedCommandHuman(startLaunchResult, "launch"));
    logProgress("launch: waiting for remote debugging endpoint...");
    await deps.waitForRemoteDebuggingReady({ remoteDebuggingPort });
    logProgress("launch: remote debugging endpoint ready");

    const gatewayBind = resolveGatewayBindFromAutomationUrl(config);
    logProgress("gateway: starting...");
    const startGatewayResult = deps.startGatewayCmd({
      host: typeof parsed.options.host === "string" ? parsed.options.host : gatewayBind.host,
      port: typeof parsed.options.port === "number" ? parsed.options.port : gatewayBind.port,
      ...(parsed.options.debug === true && { debug: true }),
      force: parsed.options.force === true,
      ...(parsed.options.detach === true && { detached: true }),
      logFile: `${logFileDir}/gateway.log`,
    });
    await startGatewayResult.ready;
    logProgress(formatSpawnedCommandHuman(startGatewayResult, "gateway"));
    logProgress("gateway: waiting for automation gateway /ready...");
    await deps.waitForAutomationReady({ automationUrl });
    logProgress("gateway: automation gateway ready");
    logProgress("dispatcher: waiting for /health...");
    await deps.waitForDispatcherHealth({ dispatcherUrl });
    logProgress("dispatcher: /health reported ok");

    logProgress("worker: starting...");
    const startWorkerResult = deps.startWorkerCmd({
      repoDir:
        (typeof parsed.options.repoDir === "string" ? parsed.options.repoDir : undefined)
        || projectPath,
      dispatcherUrl,
      automationUrl,
      workerId,
      ...(parsed.options.debug === true && { debug: true }),
      traeBin,
      remoteDebuggingPort,
      pollIntervalMs: typeof parsed.options.pollIntervalMs === "number" ? parsed.options.pollIntervalMs : undefined,
      ...(parsed.options.once === true && { once: true }),
      force: parsed.options.force === true,
      ...(parsed.options.detach === true && { detached: true }),
      logFile: `${logFileDir}/worker.log`,
    });
    await startWorkerResult.ready;
    logProgress(formatSpawnedCommandHuman(startWorkerResult, "worker"));
    logProgress("all: runtime startup complete");

    if (jsonOutput) {
      deps.log(JSON.stringify({ launch: startLaunchResult, gateway: startGatewayResult, worker: startWorkerResult }, null, 2));
    }
    return {
      launch: startLaunchResult,
      gateway: startGatewayResult,
      worker: startWorkerResult,
    };
  }

  throw new Error("unreachable");
}

export async function main(argv = process.argv.slice(2)) {
  await runCli(argv);
}

export function isCliEntrypoint(
  importMetaUrl: string,
  argv1 = process.argv[1],
  realpathSync: (path: string) => string = fs.realpathSync.native ?? fs.realpathSync,
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
    if (error instanceof Error && error.message === "command is required") {
      console.log(getMainHelpText());
      process.exit(1);
    }
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
