import fs from "node:fs";
import path from "node:path";
import { execSync, type StdioOptions } from "node:child_process";
import { pathToFileURL } from "node:url";

function resolveRepoRoot(): string {
  return path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
}

function newestMtimeMs(targetPath: string): number {
  if (!fs.existsSync(targetPath)) {
    return 0;
  }
  const stat = fs.statSync(targetPath);
  if (!stat.isDirectory()) {
    return stat.mtimeMs;
  }
  return fs.readdirSync(targetPath)
    .map((entry) => newestMtimeMs(path.join(targetPath, entry)))
    .reduce((max, current) => Math.max(max, current), stat.mtimeMs);
}

function ensureDistFile(input: {
  distPath: string;
  buildCommand: string;
  repoRoot: string;
  sourceDir?: string;
  stdio?: StdioOptions;
}): void {
  const distMtime = fs.existsSync(input.distPath) ? fs.statSync(input.distPath).mtimeMs : 0;
  if (distMtime > 0 && (!input.sourceDir || newestMtimeMs(input.sourceDir) <= distMtime)) {
    return;
  }
  execSync(input.buildCommand, {
    cwd: input.repoRoot,
    stdio: input.stdio ?? "inherit",
  });
}

function ensureBetaRuntimeCoreDist(relativeDistPath: string, stdio?: StdioOptions): string {
  const repoRoot = resolveRepoRoot();
  const distPath = path.join(repoRoot, "packages/beta-runtime-core/dist", relativeDistPath);
  ensureDistFile({
    repoRoot,
    distPath,
    buildCommand: "pnpm --filter @tingrudeng/beta-runtime-core build",
    sourceDir: path.join(repoRoot, "packages/beta-runtime-core/src"),
    stdio,
  });
  return distPath;
}

export function ensureTaskWorktreeRuntimeDist(): void {
  ensureBetaRuntimeCoreDist("runtime/task-worktree.js");
}

export function ensureDispatcherRuntimeBridgeDist(): void {
  const repoRoot = resolveRepoRoot();
  ensureDistFile({
    repoRoot,
    distPath: path.join(repoRoot, "apps/dispatcher/dist/modules/server/runtime-glue-dispatcher-client.js"),
    buildCommand: "pnpm --dir apps/dispatcher run build",
    sourceDir: path.join(repoRoot, "apps/dispatcher/src/modules/server"),
  });
}

export async function importDispatcherRuntimeBridge<T>(): Promise<T> {
  ensureDispatcherRuntimeBridgeDist();
  const repoRoot = resolveRepoRoot();
  const distPath = path.join(repoRoot, "apps/dispatcher/dist/modules/server/runtime-glue-dispatcher-client.js");
  return import(pathToFileURL(distPath).href) as Promise<T>;
}

export async function importWorkerDaemonRuntime<T>(): Promise<T> {
  const distPath = ensureBetaRuntimeCoreDist("runtime/worker-daemon.js");
  return import(pathToFileURL(distPath).href) as Promise<T>;
}

export async function importWorkerAssignmentRuntime<T>(): Promise<T> {
  const distPath = ensureBetaRuntimeCoreDist("index.js");
  return import(pathToFileURL(distPath).href) as Promise<T>;
}

export interface DispatcherDeliveryRuntimeModule {
  getDispatcherAuthHeader: () => Record<string, string>;
  retryHeartbeatDelivery: <T>(input: {
    maxAttempts?: number;
    retryDelayMs?: number;
    send: (attempt: number) => Promise<T>;
    signal?: AbortSignal;
  }) => Promise<T>;
  snapshotHeartbeatPayload: <T>(payload: T) => T;
  resolveProgressDeliveryPolicy: () => { maxAttempts: number; retryDelayMs: number };
  retryProgressDelivery: <T>(input: {
    maxAttempts: number;
    retryDelayMs: number;
    send: (attempt: number) => Promise<T>;
    signal?: AbortSignal;
  }) => Promise<T>;
  snapshotProgressPayload: <T>(payload: T) => T;
}

export async function importDispatcherDeliveryRuntime(
  options: { quiet?: boolean } = {},
): Promise<DispatcherDeliveryRuntimeModule> {
  const stdio: StdioOptions | undefined = options.quiet
    ? ["ignore", "ignore", "inherit"]
    : undefined;
  const distPath = ensureBetaRuntimeCoreDist("index.js", stdio);
  return import(pathToFileURL(distPath).href) as Promise<DispatcherDeliveryRuntimeModule>;
}

export async function importDispatcherWorkerRuntimeFactories<T>(): Promise<T> {
  const repoRoot = resolveRepoRoot();
  const runtimeDir = path.join(repoRoot, "apps/dispatcher/dist/modules/runtime");
  const codexPath = path.join(runtimeDir, "codex.js");
  ensureDistFile({
    repoRoot,
    distPath: codexPath,
    buildCommand: "pnpm --filter @forgeflow/dispatcher build",
    sourceDir: path.join(repoRoot, "apps/dispatcher/src/modules/runtime"),
  });
  const codexModule = await import(pathToFileURL(codexPath).href);
  const geminiModule = await import(pathToFileURL(path.join(runtimeDir, "gemini.js")).href);
  return {
    createCodexRuntime: codexModule.createCodexRuntime,
    createGeminiRuntime: geminiModule.createGeminiRuntime,
  } as T;
}
