#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { formatLocalTimestamp } from "./lib/time.js";

const CODEX_MODEL = process.env.FORGEFLOW_CODEX_MODEL?.trim() || "";
const GEMINI_MODEL = "gemini-2.5-pro";

interface WorkerRuntimeLike {
  launchTask(input: { taskId: string; prompt: string; mode: "run"; worktreeDir: string }): { argv: string[] };
}

interface RuntimeCoreModule {
  runWorkerAssignmentCli: (options: {
    usageCommand: string;
    buildLaunchCommand: (input: unknown) => unknown;
    execTimeoutMs?: number;
    verificationTimeoutMs?: number;
    generatedAt?: () => string;
  }) => Promise<void>;
  buildDispatcherRuntimeLaunchCommand: (input: unknown, options: {
    codexModel?: string;
    geminiModel: string;
    createCodexRuntime: (role: "worker", options?: { model?: string }) => WorkerRuntimeLike;
    createGeminiRuntime: (options?: { model?: string; extraArgs?: string[] }) => WorkerRuntimeLike;
  }) => unknown;
}

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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

function ensureBuiltFile(distPath: string, buildCommand: string, sourceDir?: string): void {
  const distMtime = fs.existsSync(distPath) ? fs.statSync(distPath).mtimeMs : 0;
  if (distMtime > 0 && (!sourceDir || newestMtimeMs(sourceDir) <= distMtime)) {
    return;
  }
  execSync(buildCommand, {
    cwd: repoRoot(),
    stdio: "inherit",
  });
}

async function loadRuntimeCore(): Promise<RuntimeCoreModule> {
  const packageRoot = path.join(repoRoot(), "packages", "beta-runtime-core");
  const distPath = path.join(packageRoot, "dist", "index.js");
  ensureBuiltFile(distPath, "pnpm --filter @tingrudeng/beta-runtime-core build", path.join(packageRoot, "src"));
  return import(pathToFileURL(distPath).href) as Promise<RuntimeCoreModule>;
}

async function loadRuntimeFactories(): Promise<{
  createCodexRuntime: (role: "worker", options?: { model?: string }) => WorkerRuntimeLike;
  createGeminiRuntime: (options?: { model?: string; extraArgs?: string[] }) => WorkerRuntimeLike;
}> {
  const runtimeDir = path.join(repoRoot(), "apps", "dispatcher", "dist", "modules", "runtime");
  const codexPath = path.join(runtimeDir, "codex.js");
  ensureBuiltFile(codexPath, "pnpm --filter @forgeflow/dispatcher build", path.join(repoRoot(), "apps", "dispatcher", "src", "modules", "runtime"));
  const codexModule = await import(pathToFileURL(codexPath).href);
  const geminiModule = await import(pathToFileURL(path.join(runtimeDir, "gemini.js")).href);
  return {
    createCodexRuntime: codexModule.createCodexRuntime,
    createGeminiRuntime: geminiModule.createGeminiRuntime,
  };
}

async function main(): Promise<void> {
  const runtimeCore = await loadRuntimeCore();
  const runtimeFactories = await loadRuntimeFactories();
  await runtimeCore.runWorkerAssignmentCli({
    usageCommand: "node scripts/run-worker-assignment.js",
    buildLaunchCommand: (input) => runtimeCore.buildDispatcherRuntimeLaunchCommand(input, {
      ...runtimeFactories,
      codexModel: CODEX_MODEL,
      geminiModel: GEMINI_MODEL,
    }),
    execTimeoutMs: Number(process.env.FORGEFLOW_EXEC_TIMEOUT_MS) || undefined,
    verificationTimeoutMs: Number(process.env.FORGEFLOW_VERIFICATION_TIMEOUT_MS) || undefined,
    generatedAt: formatLocalTimestamp,
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
