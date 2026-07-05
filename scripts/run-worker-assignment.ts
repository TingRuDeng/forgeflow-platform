#!/usr/bin/env node

import { formatLocalTimestamp } from "./lib/time.js";
import {
  importDispatcherWorkerRuntimeFactories,
  importWorkerAssignmentRuntime,
} from "./lib/runtime-bootstrap.js";

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

interface RuntimeFactoryModule {
  createCodexRuntime: (role: "worker", options?: { model?: string }) => WorkerRuntimeLike;
  createGeminiRuntime: (options?: { model?: string; extraArgs?: string[] }) => WorkerRuntimeLike;
}

async function main(): Promise<void> {
  const runtimeCore = await importWorkerAssignmentRuntime<RuntimeCoreModule>();
  const runtimeFactories = await importDispatcherWorkerRuntimeFactories<RuntimeFactoryModule>();
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
