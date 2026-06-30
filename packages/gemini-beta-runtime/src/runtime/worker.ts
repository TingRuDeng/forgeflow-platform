#!/usr/bin/env node

import { runWorkerDaemon } from "./worker-daemon.js";

interface ParsedArgs {
  dispatcherUrl?: string;
  workerId?: string;
  pool?: string;
  repoDir?: string;
  hostname?: string;
  labels?: string[];
  geminiBin?: string;
  pollIntervalMs: number;
  dryRunExecution: boolean;
  once: boolean;
  help?: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
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
    if (arg === "--gemini-bin" && next) {
      args.geminiBin = next;
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

function printHelp(): void {
  console.log(`
Usage:
  node dist/runtime/worker.js \\
    --dispatcher-url http://127.0.0.1:8787 \\
    --worker-id gemini-mac-mini \\
    --pool gemini \\
    --repo-dir /abs/path/to/repo \\
    [--gemini-bin gemini] \\
    [--hostname mac-mini] \\
    [--labels mac,gemini] \\
    [--poll-interval-ms 5000] \\
    [--dry-run-execution] \\
    [--once]
`);
}

async function main(): Promise<void> {
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
  if (args.pool !== "gemini") {
    throw new Error("--pool must be gemini");
  }

  if (args.geminiBin) {
    process.env.FORGEFLOW_GEMINI_BIN = args.geminiBin;
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
