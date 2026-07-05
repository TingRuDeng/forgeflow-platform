#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { formatLocalTimestamp } from "./lib/time.js";
const CODEX_MODEL = process.env.FORGEFLOW_CODEX_MODEL?.trim() || "";
const GEMINI_MODEL = "gemini-2.5-pro";
function repoRoot() {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}
function ensureBuiltFile(distPath, buildCommand) {
    if (fs.existsSync(distPath)) {
        return;
    }
    execSync(buildCommand, {
        cwd: repoRoot(),
        stdio: "inherit",
    });
}
async function loadAssignmentRunner() {
    const distPath = path.join(repoRoot(), "packages", "beta-runtime-core", "dist", "runtime", "run-worker-assignment-cli.js");
    ensureBuiltFile(distPath, "pnpm --filter @tingrudeng/beta-runtime-core build");
    return import(pathToFileURL(distPath).href);
}
async function loadRuntimeFactories() {
    const runtimeDir = path.join(repoRoot(), "apps", "dispatcher", "dist", "modules", "runtime");
    const codexPath = path.join(runtimeDir, "codex.js");
    ensureBuiltFile(codexPath, "pnpm --filter @forgeflow/dispatcher build");
    const codexModule = await import(pathToFileURL(codexPath).href);
    const geminiModule = await import(pathToFileURL(path.join(runtimeDir, "gemini.js")).href);
    return {
        createCodexRuntime: codexModule.createCodexRuntime,
        createGeminiRuntime: geminiModule.createGeminiRuntime,
    };
}
async function buildLaunchCommand(input) {
    const { createCodexRuntime, createGeminiRuntime } = await loadRuntimeFactories();
    const launchInput = {
        taskId: input.assignment.taskId,
        prompt: input.prompt,
        mode: "run",
        worktreeDir: input.worktreeDir,
    };
    if (input.assignment.pool === "codex") {
        const runtime = createCodexRuntime("worker", { model: CODEX_MODEL });
        return {
            provider: "codex",
            argv: runtime.launchTask(launchInput).argv,
            cwd: input.worktreeDir,
        };
    }
    const runtime = createGeminiRuntime({ model: GEMINI_MODEL });
    return {
        provider: "gemini",
        argv: runtime.launchTask(launchInput).argv,
        cwd: input.worktreeDir,
    };
}
async function main() {
    const { runWorkerAssignmentCli } = await loadAssignmentRunner();
    await runWorkerAssignmentCli({
        usageCommand: "node scripts/run-worker-assignment.js",
        buildLaunchCommand,
        execTimeoutMs: Number(process.env.FORGEFLOW_EXEC_TIMEOUT_MS) || undefined,
        verificationTimeoutMs: Number(process.env.FORGEFLOW_VERIFICATION_TIMEOUT_MS) || undefined,
        generatedAt: formatLocalTimestamp,
    });
}
main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
