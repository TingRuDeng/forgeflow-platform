import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
function resolveRepoRoot() {
    return path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
}
function ensureDistFile(input) {
    if (fs.existsSync(input.distPath)) {
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
    });
    return import(pathToFileURL(distPath).href);
}
