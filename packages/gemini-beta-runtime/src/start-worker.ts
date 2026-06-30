import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess, type StdioOptions } from "node:child_process";
import { fileURLToPath } from "node:url";

import { listManagedProcesses } from "./process-control.js";

export interface StartWorkerOptions {
  repoDir?: string;
  dispatcherUrl?: string;
  workerId?: string;
  pool?: "gemini";
  geminiBin?: string;
  pollIntervalMs?: number;
  dryRunExecution?: boolean;
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
  workerId: string;
  pool: string;
  geminiBin: string;
}) {
  const trailingFlags = ["--pool", "--gemini-bin", "--poll-interval-ms", "--dry-run-execution", "--once"];
  const actualRepoDir = readFlagValue(command, "--repo-dir", ["--dispatcher-url", "--worker-id", ...trailingFlags]);
  const actualDispatcherUrl = readFlagValue(command, "--dispatcher-url", ["--worker-id", ...trailingFlags]);
  const actualWorkerId = readFlagValue(command, "--worker-id", trailingFlags);
  const actualPool = readFlagValue(command, "--pool", ["--gemini-bin", "--poll-interval-ms", "--dry-run-execution", "--once"]);
  const actualGeminiBin = readFlagValue(command, "--gemini-bin", ["--poll-interval-ms", "--dry-run-execution", "--once"]);

  return actualRepoDir === input.repoDir
    && actualDispatcherUrl === input.dispatcherUrl
    && actualWorkerId === input.workerId
    && actualPool === input.pool
    && actualGeminiBin === input.geminiBin;
}

export function startWorker(options: StartWorkerOptions = {}): SpawnedForgeFlowCommand {
  const packageRootDir = resolvePackageRootDir();
  const scriptPath = path.join(packageRootDir, "dist", "runtime", "worker.js");

  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Gemini worker script not found: ${scriptPath}`);
  }

  const repoDir = String(options.repoDir || process.env.FORGEFLOW_REPO_DIR || "").trim();
  if (!repoDir) {
    throw new Error("repoDir is required");
  }

  const dispatcherUrl = String(options.dispatcherUrl || process.env.FORGEFLOW_DISPATCHER_URL || "http://127.0.0.1:8787").trim();
  const workerId = String(options.workerId || process.env.FORGEFLOW_WORKER_ID || "gemini-remote").trim();
  const pool = String(options.pool || process.env.FORGEFLOW_WORKER_POOL || "gemini").trim();
  const geminiBin = String(options.geminiBin || process.env.FORGEFLOW_GEMINI_BIN || "gemini").trim();

  if (pool !== "gemini") {
    throw new Error(`pool must be gemini, got ${pool}`);
  }

  const args = [
    "--repo-dir",
    repoDir,
    "--dispatcher-url",
    dispatcherUrl,
    "--worker-id",
    workerId,
    "--pool",
    "gemini",
    "--gemini-bin",
    geminiBin,
  ];

  if (options.pollIntervalMs !== undefined) {
    args.push("--poll-interval-ms", String(Number(options.pollIntervalMs)));
  }
  if (options.dryRunExecution) {
    args.push("--dry-run-execution");
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
        workerId,
        pool: "gemini",
        geminiBin,
      })) {
        throw new Error(
          "existing managed worker does not match requested repo/dispatcher/worker/pool/gemini-bin settings; use --force to replace it",
        );
      }
      return reuseExistingProcess(scriptPath, args, existing.pid, options, packageRootDir);
    }
  }

  return spawnNodeScript(scriptPath, args, options, packageRootDir);
}
