import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess, type StdioOptions } from "node:child_process";
import { fileURLToPath } from "node:url";

export interface StartLaunchOptions {
  traeBin?: string;
  projectPath?: string;
  remoteDebuggingPort?: number;
  timeoutMs?: number;
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

function spawnNodeScript(scriptPath: string, args: string[], options: StartLaunchOptions): SpawnedForgeFlowCommand {
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
    cwd: path.dirname(path.dirname(scriptPath)),
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
    cwd: path.dirname(path.dirname(scriptPath)),
    scriptPath,
    child,
    ready: waitForSpawn(child, `${nodePath} ${scriptPath}`),
  };
}

export function startLaunch(options: StartLaunchOptions = {}): SpawnedForgeFlowCommand {
  const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "runtime", "run-trae-automation-launch.js");

  const traeBin = String(
    options.traeBin
    || process.env.FORGEFLOW_TRAE_BIN
    || process.env.TRAE_BIN
    || "",
  ).trim();
  if (!traeBin) {
    throw new Error("traeBin is required");
  }

  const projectPath = String(
    options.projectPath
    || process.env.FORGEFLOW_REPO_DIR
    || process.env.TRAE_PROJECT_PATH
    || "",
  ).trim();
  if (!projectPath) {
    throw new Error("projectPath is required");
  }

  const remoteDebuggingPort = Number(
    options.remoteDebuggingPort
    || process.env.FORGEFLOW_REMOTE_DEBUGGING_PORT
    || process.env.TRAE_REMOTE_DEBUGGING_PORT
    || 9222
  );
  const args = [
    "--trae-bin",
    traeBin,
    "--project-path",
    projectPath,
    "--remote-debugging-port",
    String(remoteDebuggingPort),
  ];

  if (options.timeoutMs !== undefined) {
    args.push("--timeout-ms", String(Number(options.timeoutMs)));
  }

  return spawnNodeScript(scriptPath, args, options);
}
