import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess, type StdioOptions } from "node:child_process";
import { fileURLToPath } from "node:url";

import { listManagedProcesses } from "./process-control.js";

export interface StartGatewayOptions {
  host?: string;
  port?: number;
  debug?: boolean;
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

function spawnNodeScript(scriptPath: string, args: string[], options: StartGatewayOptions): SpawnedForgeFlowCommand {
  const nodePath = String(options.nodePath || process.execPath).trim() || process.execPath;
  const cwd = path.dirname(path.dirname(scriptPath));
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
  options: StartGatewayOptions,
): SpawnedForgeFlowCommand {
  const nodePath = String(options.nodePath || process.execPath).trim() || process.execPath;
  const cwd = path.dirname(path.dirname(scriptPath));
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

function matchesGatewayCommand(command: string, host: string, port: number, debug: boolean) {
  const actualHost = readFlagValue(command, "--host", ["--port"]);
  const actualPort = readFlagValue(command, "--port", ["--debug"]);
  const actualDebug = command.includes(" --debug");
  return actualHost === host && actualPort === String(port) && actualDebug === debug;
}

export function startGateway(options: StartGatewayOptions = {}): SpawnedForgeFlowCommand {
  const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "runtime", "run-trae-automation-gateway.js");

  const host = String(
    options.host
    || process.env.FORGEFLOW_AUTOMATION_HOST
    || "127.0.0.1",
  ).trim() || "127.0.0.1";
  const port = Number(
    options.port
    || process.env.FORGEFLOW_AUTOMATION_PORT
    || 8790,
  );
  const debug = options.debug === true;
  const args = ["--host", host, "--port", String(port)];
  if (debug) {
    args.push("--debug");
  }

  if (!options.force) {
    const status = listManagedProcesses("gateway");
    const existing = status.matches[0];
    if (existing) {
      if (!matchesGatewayCommand(existing.command, host, port, debug)) {
        throw new Error(
          "existing managed gateway does not match requested host/port/debug settings; use --force to replace it",
        );
      }
      return reuseExistingProcess(scriptPath, args, existing.pid, options);
    }
  }

  return spawnNodeScript(scriptPath, args, options);
}
