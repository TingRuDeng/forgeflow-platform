import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { handleDispatcherHttpRequest } from "./dispatcher-server.js";

function resolveDispatcherDist(): { repoRoot: string; distPath: string } {
  const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
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

interface ReviewDecisionBridge {
  createHttpReviewClient: (options: { dispatcherUrl: string }) => unknown;
  createStateDirReviewClientFactory: (handler: typeof handleDispatcherHttpRequest) => (stateDir: string) => unknown;
  submitReviewDecision: (input: Record<string, unknown>) => Promise<unknown>;
  mergePullRequestGitHub: (input: Record<string, unknown>) => Promise<unknown>;
}

async function bootstrapReviewDecisionBridge(): Promise<ReviewDecisionBridge> {
  const { repoRoot, distPath } = resolveDispatcherDist();
  if (!fs.existsSync(distPath)) {
    ensureDispatcherDist();
  }
  const distDir = path.join(repoRoot, "apps/dispatcher/dist");
  return import(path.join(distDir, "modules/server/runtime-glue-review-decision.js")) as Promise<ReviewDecisionBridge>;
}

const bridge = await bootstrapReviewDecisionBridge();

const createHttpReviewClient = bridge.createHttpReviewClient;
const createStateDirReviewClientFactory = bridge.createStateDirReviewClientFactory;
const tsSubmitReviewDecision = bridge.submitReviewDecision;
const mergePullRequestGitHub = bridge.mergePullRequestGitHub;

export { mergePullRequestGitHub };

export function createDispatcherReviewClient(dispatcherUrl: string): unknown {
  return createHttpReviewClient({ dispatcherUrl });
}

export function createStateDirReviewClient(stateDir: string): unknown {
  const factory = createStateDirReviewClientFactory(handleDispatcherHttpRequest);
  return factory(stateDir);
}

export async function submitReviewDecision(input: Record<string, unknown>): Promise<unknown> {
  return tsSubmitReviewDecision({
    ...input,
    githubToken: input.githubToken ?? process.env.GITHUB_TOKEN,
  });
}
