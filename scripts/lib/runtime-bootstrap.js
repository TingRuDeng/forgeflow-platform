import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
function resolveRepoRoot() {
    return path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
}
function newestMtimeMs(targetPath) {
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
function ensureDistFile(input) {
    const distMtime = fs.existsSync(input.distPath) ? fs.statSync(input.distPath).mtimeMs : 0;
    if (distMtime > 0 && (!input.sourceDir || newestMtimeMs(input.sourceDir) <= distMtime)) {
        return;
    }
    execSync(input.buildCommand, {
        cwd: input.repoRoot,
        stdio: "inherit",
    });
}
export function ensureDispatcherRuntimeBridgeDist() {
    const repoRoot = resolveRepoRoot();
    ensureDistFile({
        repoRoot,
        distPath: path.join(repoRoot, "apps/dispatcher/dist/modules/server/runtime-glue-dispatcher-client.js"),
        buildCommand: "pnpm --dir apps/dispatcher run build",
        sourceDir: path.join(repoRoot, "apps/dispatcher/src/modules/server"),
    });
}
export async function importDispatcherRuntimeBridge() {
    ensureDispatcherRuntimeBridgeDist();
    const repoRoot = resolveRepoRoot();
    const distPath = path.join(repoRoot, "apps/dispatcher/dist/modules/server/runtime-glue-dispatcher-client.js");
    return import(pathToFileURL(distPath).href);
}
export async function importWorkerDaemonRuntime() {
    const repoRoot = resolveRepoRoot();
    const distPath = path.join(repoRoot, "packages/beta-runtime-core/dist/runtime/worker-daemon.js");
    ensureDistFile({
        repoRoot,
        distPath,
        buildCommand: "pnpm --filter @tingrudeng/beta-runtime-core build",
        sourceDir: path.join(repoRoot, "packages/beta-runtime-core/src"),
    });
    return import(pathToFileURL(distPath).href);
}
export async function importWorkerAssignmentRuntime() {
    const repoRoot = resolveRepoRoot();
    const distPath = path.join(repoRoot, "packages/beta-runtime-core/dist/index.js");
    ensureDistFile({
        repoRoot,
        distPath,
        buildCommand: "pnpm --filter @tingrudeng/beta-runtime-core build",
        sourceDir: path.join(repoRoot, "packages/beta-runtime-core/src"),
    });
    return import(pathToFileURL(distPath).href);
}
export async function importDispatcherWorkerRuntimeFactories() {
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
    };
}
