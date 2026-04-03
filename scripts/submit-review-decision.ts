#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function resolveDispatcherDist(): { repoRoot: string; distPath: string } {
  const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
  const distPath = path.join(repoRoot, "apps/dispatcher/dist/modules/server/runtime-glue-review-decision.js");
  return { repoRoot, distPath };
}

function ensureDispatcherDist(): void {
  const { repoRoot, distPath } = resolveDispatcherDist();
  if (fs.existsSync(distPath)) {
    return;
  }
  execSync("pnpm --dir apps/dispatcher run build", {
    cwd: repoRoot,
    stdio: "inherit",
  });
}

async function bootstrapReviewDecisionBridge(): Promise<any> {
  const { repoRoot, distPath } = resolveDispatcherDist();
  if (!fs.existsSync(distPath)) {
    ensureDispatcherDist();
  }
  const distDir = path.join(repoRoot, "apps/dispatcher/dist");
  return import(path.join(distDir, "modules/server/runtime-glue-review-decision.js"));
}

const bridge = await bootstrapReviewDecisionBridge();

const createHttpReviewClient = bridge.createHttpReviewClient;
const createStateDirReviewClientFactory = bridge.createStateDirReviewClientFactory;
const tsSubmitReviewDecision = bridge.submitReviewDecision;
const mergePullRequestGitHub = bridge.mergePullRequestGitHub;

const { handleDispatcherHttpRequest } = await import("./lib/dispatcher-server.js");

function createDispatcherReviewClient(dispatcherUrl: string): any {
  return createHttpReviewClient({ dispatcherUrl });
}

function createStateDirReviewClient(stateDir: string): any {
  const factory = createStateDirReviewClientFactory(handleDispatcherHttpRequest);
  return factory(stateDir);
}

async function submitReviewDecision(input: any): Promise<any> {
  return tsSubmitReviewDecision({
    ...input,
    githubToken: input.githubToken ?? process.env.GITHUB_TOKEN,
  });
}

interface ParsedArgs {
  actor: string;
  dryRun: boolean;
  mergePullRequest: boolean;
  dispatcherUrl?: string;
  stateDir?: string;
  taskId?: string;
  decision?: string;
  notes?: string;
  repo?: string;
  pullRequestNumber?: number;
  help?: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    actor: "codex-control",
    dryRun: false,
    mergePullRequest: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--dispatcher-url" && next) {
      args.dispatcherUrl = next;
      index += 1;
      continue;
    }
    if (arg === "--state-dir" && next) {
      args.stateDir = next;
      index += 1;
      continue;
    }
    if (arg === "--task-id" && next) {
      args.taskId = next;
      index += 1;
      continue;
    }
    if (arg === "--actor" && next) {
      args.actor = next;
      index += 1;
      continue;
    }
    if (arg === "--decision" && next) {
      args.decision = next;
      index += 1;
      continue;
    }
    if (arg === "--notes" && next) {
      args.notes = next;
      index += 1;
      continue;
    }
    if (arg === "--repo" && next) {
      args.repo = next;
      index += 1;
      continue;
    }
    if (arg === "--pull-request-number" && next) {
      args.pullRequestNumber = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--merge-pr") {
      args.mergePullRequest = true;
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
  node scripts/submit-review-decision.js \\
    --dispatcher-url http://127.0.0.1:8787 \\
    --task-id dispatch-1:task-1 \\
    --decision merge|rework \\
    [--actor codex-control] \\
    [--notes "..."] \\
    [--repo owner/repo --pull-request-number 12 --merge-pr] \\
    [--dry-run]

  node scripts/submit-review-decision.js \\
    --state-dir /path/to/state-dir \\
    --task-id dispatch-1:task-1 \\
    --decision merge|rework \\
    [--actor codex-control] \\
    [--notes "..."] \\
    [--repo owner/repo --pull-request-number 12 --merge-pr] \\
    [--dry-run]
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.taskId) {
    throw new Error("--task-id is required");
  }
  if (!args.decision || !["merge", "rework"].includes(args.decision)) {
    throw new Error("--decision must be merge or rework");
  }
  if (!args.dispatcherUrl && !args.stateDir && !args.dryRun) {
    throw new Error("--dispatcher-url or --state-dir is required unless --dry-run is used");
  }

  if (args.dryRun) {
    console.log(JSON.stringify({
      taskId: args.taskId,
      actor: args.actor,
      decision: args.decision,
      notes: args.notes ?? "",
      mergePullRequest: args.mergePullRequest,
      repo: args.repo ?? null,
      pullRequestNumber: args.pullRequestNumber ?? null,
    }, null, 2));
    return;
  }

  const client = args.stateDir
    ? createStateDirReviewClient(args.stateDir)
    : createDispatcherReviewClient(args.dispatcherUrl!);

  const result = await submitReviewDecision({
    client,
    taskId: args.taskId,
    actor: args.actor,
    decision: args.decision,
    notes: args.notes,
    repo: args.repo,
    pullRequestNumber: args.pullRequestNumber,
    mergePullRequest: args.mergePullRequest,
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
