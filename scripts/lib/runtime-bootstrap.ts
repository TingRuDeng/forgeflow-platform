import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";

function resolveRepoRoot(): string {
  return path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
}

function ensureDistFile(input: { distPath: string; buildCommand: string; repoRoot: string }): void {
  if (fs.existsSync(input.distPath)) {
    return;
  }
  execSync(input.buildCommand, {
    cwd: input.repoRoot,
    stdio: "inherit",
  });
}

export function ensureDispatcherRuntimeBridgeDist(): void {
  const repoRoot = resolveRepoRoot();
  ensureDistFile({
    repoRoot,
    distPath: path.join(repoRoot, "apps/dispatcher/dist/modules/server/runtime-glue-dispatcher-client.js"),
    buildCommand: "pnpm --dir apps/dispatcher run build",
  });
}

export async function importDispatcherRuntimeBridge<T>(): Promise<T> {
  ensureDispatcherRuntimeBridgeDist();
  const repoRoot = resolveRepoRoot();
  const distPath = path.join(repoRoot, "apps/dispatcher/dist/modules/server/runtime-glue-dispatcher-client.js");
  return import(pathToFileURL(distPath).href) as Promise<T>;
}

export async function importWorkerDaemonRuntime<T>(): Promise<T> {
  const repoRoot = resolveRepoRoot();
  const distPath = path.join(repoRoot, "packages/beta-runtime-core/dist/runtime/worker-daemon.js");
  ensureDistFile({
    repoRoot,
    distPath,
    buildCommand: "pnpm --filter @tingrudeng/beta-runtime-core build",
  });
  return import(pathToFileURL(distPath).href) as Promise<T>;
}
