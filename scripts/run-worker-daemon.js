#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { runWorkerDaemon } from "./lib/worker-daemon.js";
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const distPath = path.join(repoRoot, "apps/dispatcher/dist/modules/server/runtime-glue-dispatcher-client.js");
function ensureDispatcherDist() {
    if (fs.existsSync(distPath)) {
        return;
    }
    console.error("Bootstrapping dispatcher dist...");
    execSync("pnpm --dir apps/dispatcher run build", {
        cwd: repoRoot,
        stdio: "inherit",
    });
}
function parseArgs(argv) {
    const args = {
        pollIntervalMs: 5000,
        dryRunExecution: false,
        once: false,
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        const next = argv[index + 1];
        if (arg === "--dispatcher-url" && next) {
            args.dispatcherUrl = next;
            index += 1;
            continue;
        }
        if (arg === "--worker-id" && next) {
            args.workerId = next;
            index += 1;
            continue;
        }
        if (arg === "--pool" && next) {
            args.pool = next;
            index += 1;
            continue;
        }
        if (arg === "--repo-dir" && next) {
            args.repoDir = next;
            index += 1;
            continue;
        }
        if (arg === "--hostname" && next) {
            args.hostname = next;
            index += 1;
            continue;
        }
        if (arg === "--labels" && next) {
            args.labels = next.split(",").map((item) => item.trim()).filter(Boolean);
            index += 1;
            continue;
        }
        if (arg === "--poll-interval-ms" && next) {
            args.pollIntervalMs = Number(next);
            index += 1;
            continue;
        }
        if (arg === "--dry-run-execution") {
            args.dryRunExecution = true;
            continue;
        }
        if (arg === "--once") {
            args.once = true;
            continue;
        }
        if (arg === "--help") {
            args.help = true;
            continue;
        }
        throw new Error(`unknown argument: ${arg}`);
    }
    return args;
}
function printHelp() {
    console.log(`
Usage:
  node scripts/run-worker-daemon.js \\
    --dispatcher-url http://127.0.0.1:8787 \\
    --worker-id codex-mac-mini \\
    --pool codex \\
    --repo-dir /abs/path/to/repo \\
    [--hostname mac-mini] \\
    [--labels mac,codex] \\
    [--poll-interval-ms 5000] \\
    [--dry-run-execution] \\
    [--once]
`);
}
async function main() {
    ensureDispatcherDist();
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        printHelp();
        return;
    }
    if (!args.dispatcherUrl) {
        throw new Error("--dispatcher-url is required");
    }
    if (!args.workerId) {
        throw new Error("--worker-id is required");
    }
    if (!args.pool) {
        throw new Error("--pool is required");
    }
    if (!args.repoDir) {
        throw new Error("--repo-dir is required");
    }
    const summary = await runWorkerDaemon({
        dispatcherUrl: args.dispatcherUrl,
        workerId: args.workerId,
        pool: args.pool,
        repoDir: args.repoDir,
        hostname: args.hostname,
        labels: args.labels,
        pollIntervalMs: args.pollIntervalMs,
        dryRunExecution: args.dryRunExecution,
        once: args.once,
    });
    console.log(JSON.stringify(summary, null, 2));
}
main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
