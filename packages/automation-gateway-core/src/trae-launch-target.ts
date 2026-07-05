import fs from "node:fs";
import path from "node:path";

export interface TraeLaunchTargetFs {
  existsSync(input: string): boolean;
  readdirSync(input: string): string[];
  statSync(input: string): { isFile(): boolean };
}

export interface TraeLaunchTargetPath {
  basename(input: string, suffix?: string): string;
  join(...paths: string[]): string;
}

export interface ResolveMacAppBundleExecutableOptions {
  fsImpl?: TraeLaunchTargetFs;
  pathImpl?: TraeLaunchTargetPath;
  platform?: string;
}

export interface ResolveTraeLaunchTargetOptions {
  defaultRemoteDebuggingPort?: number | string;
  env?: Record<string, string | undefined>;
  fsImpl?: TraeLaunchTargetFs;
  pathImpl?: TraeLaunchTargetPath;
  platform?: string;
  remoteDebuggingPort?: number | string;
  traeArgs?: string | string[];
  traeBin?: string;
  projectPath?: string;
}

export interface TraeLaunchTarget {
  bundlePath: string;
  command: string;
  args: string[];
  projectPath: string;
  remoteDebuggingPort: number;
}

export function parseLaunchArgs(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (!value) {
    return [];
  }
  return String(value)
    .split(" ")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function hasRemoteDebuggingPortArg(args: string[] = []): boolean {
  return args.some((arg) => /^--remote-debugging-port=/.test(arg));
}

export function resolveMacAppBundleExecutable(command: string, options: ResolveMacAppBundleExecutableOptions = {}): string {
  const fsImpl = options.fsImpl || (fs as TraeLaunchTargetFs);
  const pathImpl = options.pathImpl || (path as TraeLaunchTargetPath);
  const platform = options.platform || process.platform;
  const normalized = String(command || "").trim();
  if (platform !== "darwin" || !normalized.toLowerCase().endsWith(".app") || !fsImpl.existsSync(normalized)) {
    return normalized;
  }

  const directCandidate = pathImpl.join(normalized, "Contents", "MacOS", pathImpl.basename(normalized, ".app"));
  if (fsImpl.existsSync(directCandidate)) {
    return directCandidate;
  }

  const macOsDir = pathImpl.join(normalized, "Contents", "MacOS");
  if (!fsImpl.existsSync(macOsDir)) {
    return normalized;
  }

  for (const entryName of fsImpl.readdirSync(macOsDir)) {
    const entryPath = pathImpl.join(macOsDir, entryName);
    try {
      if (fsImpl.statSync(entryPath).isFile()) {
        return entryPath;
      }
    } catch {
      // 跳过不可读取条目，继续尝试其他可执行文件。
    }
  }

  return normalized;
}

export function resolveTraeLaunchTarget(options: ResolveTraeLaunchTargetOptions = {}): TraeLaunchTarget {
  const env = options.env || process.env;
  const fsImpl = options.fsImpl || (fs as TraeLaunchTargetFs);
  const pathImpl = options.pathImpl || (path as TraeLaunchTargetPath);
  const remoteDebuggingPort = Number(
    options.remoteDebuggingPort || env.TRAE_REMOTE_DEBUGGING_PORT || options.defaultRemoteDebuggingPort || 9222,
  );

  const configuredCommand = String(options.traeBin || env.TRAE_BIN || "").trim();
  if (!configuredCommand) {
    throw new Error("TRAE_BIN or --trae-bin is required");
  }

  const projectPath = String(options.projectPath || env.TRAE_PROJECT_PATH || "").trim();
  if (!projectPath) {
    throw new Error("TRAE_PROJECT_PATH or --project-path is required");
  }
  if (!fsImpl.existsSync(projectPath)) {
    throw new Error(`project path does not exist: ${projectPath}`);
  }

  const command = resolveMacAppBundleExecutable(configuredCommand, {
    fsImpl,
    pathImpl,
    platform: options.platform || process.platform,
  });
  const args = parseLaunchArgs(options.traeArgs || env.TRAE_ARGS || "");
  if (!hasRemoteDebuggingPortArg(args)) {
    args.push(`--remote-debugging-port=${remoteDebuggingPort}`);
  }
  if (!args.includes(projectPath)) {
    args.push(projectPath);
  }

  return {
    bundlePath: configuredCommand,
    command,
    args,
    projectPath,
    remoteDebuggingPort,
  };
}
