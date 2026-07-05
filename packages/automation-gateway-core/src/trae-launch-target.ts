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
