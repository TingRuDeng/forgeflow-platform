import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess, type StdioOptions } from "node:child_process";
import { fileURLToPath } from "node:url";

import { listManagedProcesses } from "./process-control.js";

export interface StartWorkerOptions {
  repoDir?: string;
  dispatcherUrl?: string;
  automationUrl?: string;
  workerId?: string;
  traeBin?: string;
  remoteDebuggingPort?: number;
  pollIntervalMs?: number;
  debug?: boolean;
  once?: boolean;
  force?: boolean;
  nodePath?: string;
  env?: NodeJS.ProcessEnv;
  stdio?: StdioOptions;
  detached?: boolean;
  logFile?: string;
}

export interface SpawnedForgeFlowCommand {
  command: string;
  args: string[];
  cwd: string;
  scriptPath: string;
  child: ChildProcess;
  ready: Promise<void>;
}

function resolvePackageRootDir() {
  return path.dirname(path.dirname(fileURLToPath(import.meta.url)));
}

function waitForSpawn(child: ChildProcess, label: string) {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const onError = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(new Error(`Failed to start ${label}: ${error.message}`));
    };

    child.once("error", onError);
    setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.off("error", onError);
      resolve();
    }, 0);
  });
}

function spawnNodeScript(
  scriptPath: string,
  args: string[],
  options: StartWorkerOptions,
  cwd: string,
): SpawnedForgeFlowCommand {
  const nodePath = String(options.nodePath || process.execPath).trim() || process.execPath;
  let stdio: StdioOptions = options.stdio ?? "inherit";
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...(options.env || {}),
  };

  if (options.detached && options.logFile) {
    const logFd = fs.openSync(options.logFile, "a");
    stdio = ["ignore", logFd, logFd];
  }

  const child = spawn(nodePath, [scriptPath, ...args], {
    cwd,
    env,
    stdio,
    detached: options.detached ?? false,
  });

  if (typeof child.unref === "function" && options.detached) {
    child.unref();
  }

  return {
    command: nodePath,
    args: [scriptPath, ...args],
    cwd,
    scriptPath,
    child,
    ready: waitForSpawn(child, `${nodePath} ${scriptPath}`),
  };
}

function reuseExistingProcess(
  scriptPath: string,
  args: string[],
  existingPid: number,
  options: StartWorkerOptions,
  cwd: string,
): SpawnedForgeFlowCommand {
  const nodePath = String(options.nodePath || process.execPath).trim() || process.execPath;
  const child = {
    pid: existingPid,
    once() {
      return this;
    },
    off() {
      return this;
    },
    unref() {},
  } as unknown as ChildProcess;

  return {
    command: nodePath,
    args: [scriptPath, ...args],
    cwd,
    scriptPath,
    child,
    ready: Promise.resolve(),
  };
}

function readFlagValue(command: string, flag: string, nextFlags: string[]) {
  const marker = `${flag} `;
  const start = command.indexOf(marker);
  if (start === -1) {
    return "";
  }
  const valueStart = start + marker.length;
  const nextPositions = nextFlags
    .map((nextFlag) => command.indexOf(` ${nextFlag} `, valueStart))
    .filter((position) => position >= 0);
  const valueEnd = nextPositions.length > 0 ? Math.min(...nextPositions) : command.length;
  return command.slice(valueStart, valueEnd).trim();
}

function matchesWorkerCommand(command: string, input: {
  repoDir: string;
  dispatcherUrl: string;
  automationUrl: string;
  workerId: string;
  traeBin: string;
  remoteDebuggingPort: number;
  debug: boolean;
}) {
  const trailingFlags = ["--trae-bin", "--remote-debugging-port", "--poll-interval-ms", "--debug", "--once"];
  const actualRepoDir = readFlagValue(command, "--repo-dir", ["--dispatcher-url", "--automation-url", "--worker-id", ...trailingFlags]);
  const actualDispatcherUrl = readFlagValue(command, "--dispatcher-url", ["--automation-url", "--worker-id", ...trailingFlags]);
  const actualAutomationUrl = readFlagValue(command, "--automation-url", ["--worker-id", ...trailingFlags]);
  const actualWorkerId = readFlagValue(command, "--worker-id", trailingFlags);
  const actualTraeBin = readFlagValue(command, "--trae-bin", ["--remote-debugging-port", "--poll-interval-ms", "--once"]);
  const actualRemoteDebuggingPort = Number(
    readFlagValue(command, "--remote-debugging-port", ["--poll-interval-ms", "--debug", "--once"]),
  );
  const actualDebug = command.includes(" --debug");

  return actualRepoDir === input.repoDir
    && actualDispatcherUrl === input.dispatcherUrl
    && actualAutomationUrl === input.automationUrl
    && actualWorkerId === input.workerId
    && actualTraeBin === input.traeBin
    && actualRemoteDebuggingPort === input.remoteDebuggingPort
    && actualDebug === input.debug;
}

export function startWorker(options: StartWorkerOptions = {}): SpawnedForgeFlowCommand {
  const packageRootDir = resolvePackageRootDir();
  const scriptPath = path.join(packageRootDir, "dist", "runtime", "worker.js");

  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Trae worker script not found: ${scriptPath}`);
  }

  const repoDir = String(options.repoDir || process.env.FORGEFLOW_REPO_DIR || "").trim();
  if (!repoDir) {
    throw new Error("repoDir is required");
  }

  const dispatcherUrl = String(options.dispatcherUrl || process.env.FORGEFLOW_DISPATCHER_URL || "http://127.0.0.1:8787").trim();
  const automationUrl = String(options.automationUrl || process.env.FORGEFLOW_AUTOMATION_URL || "http://127.0.0.1:8790").trim();
  const workerId = String(options.workerId || process.env.FORGEFLOW_WORKER_ID || "trae-auto-gateway").trim();
  const traeBin = String(options.traeBin || process.env.FORGEFLOW_TRAE_BIN || process.env.TRAE_BIN || "").trim();
  const remoteDebuggingPort = Number(
    options.remoteDebuggingPort
    || process.env.FORGEFLOW_REMOTE_DEBUGGING_PORT
    || process.env.TRAE_REMOTE_DEBUGGING_PORT
    || 9222,
  );
  const debug = options.debug === true;
  const args = [
    "--repo-dir",
    repoDir,
    "--dispatcher-url",
    dispatcherUrl,
    "--automation-url",
    automationUrl,
    "--worker-id",
    workerId,
  ];

  if (traeBin) {
    args.push("--trae-bin", traeBin);
  }
  if (Number.isFinite(remoteDebuggingPort) && remoteDebuggingPort > 0) {
    args.push("--remote-debugging-port", String(remoteDebuggingPort));
  }

  if (options.pollIntervalMs !== undefined) {
    args.push("--poll-interval-ms", String(Number(options.pollIntervalMs)));
  }
  if (debug) {
    args.push("--debug");
  }
  if (options.once) {
    args.push("--once");
  }

  if (!options.force) {
    const status = listManagedProcesses("worker");
    const existing = status.matches[0];
    if (existing) {
      if (!matchesWorkerCommand(existing.command, {
        repoDir,
        dispatcherUrl,
        automationUrl,
        workerId,
        traeBin,
        remoteDebuggingPort,
        debug,
      })) {
        throw new Error(
          "existing managed worker does not match requested repo/dispatcher/automation/worker/launch/debug settings; use --force to replace it",
        );
      }
      return reuseExistingProcess(scriptPath, args, existing.pid, options, packageRootDir);
    }
  }

  return spawnNodeScript(scriptPath, args, options, packageRootDir);
}
