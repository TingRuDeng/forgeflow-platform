#!/usr/bin/env node

import { buildDispatchServerPayload, postDispatchServerPayload } from "./lib/dispatch-orchestrator.js";

interface ParsedArgs {
  requestedBy: string;
  dryRun: boolean;
  dispatcherUrl?: string;
  orchestratorDir?: string;
  help?: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    requestedBy: "codex-control",
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--dispatcher-url" && next) {
      args.dispatcherUrl = next;
      index += 1;
      continue;
    }
    if (arg === "--orchestrator-dir" && next) {
      args.orchestratorDir = next;
      index += 1;
      continue;
    }
    if (arg === "--requested-by" && next) {
      args.requestedBy = next;
      index += 1;
      continue;
    }
    if (arg === "--dry-run") {
      args.dryRun = true;
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
  node scripts/dispatch-orchestrator-to-server.js \\
    --dispatcher-url http://127.0.0.1:8787 \\
    --orchestrator-dir /abs/path/to/.orchestrator \\
    [--requested-by codex-control] \\
    [--dry-run]
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.orchestratorDir) {
    throw new Error("--orchestrator-dir is required");
  }

  const payload = buildDispatchServerPayload({
    orchestratorDir: args.orchestratorDir,
    requestedBy: args.requestedBy,
  });

  if (args.dryRun) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (!args.dispatcherUrl) {
    throw new Error("--dispatcher-url is required unless --dry-run is used");
  }

  const result = await postDispatchServerPayload({
    dispatcherUrl: args.dispatcherUrl,
    payload,
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
