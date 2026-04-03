import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { handleDispatcherHttpRequest } from "./dispatcher-server.js";
function resolveDispatcherDist() {
    const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
    const distPath = path.join(repoRoot, "apps/dispatcher/dist/modules/server/runtime-glue-review-decision.js");
    return { repoRoot, distPath };
}
function ensureDispatcherDist() {
    const { repoRoot, distPath } = resolveDispatcherDist();
    if (fs.existsSync(distPath)) {
        return;
    }
    execSync("pnpm --dir apps/dispatcher run build", {
        cwd: repoRoot,
        stdio: "inherit",
    });
}
async function bootstrapReviewDecisionBridge() {
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
export { mergePullRequestGitHub };
export function createDispatcherReviewClient(dispatcherUrl) {
    return createHttpReviewClient({ dispatcherUrl });
}
export function createStateDirReviewClient(stateDir) {
    const factory = createStateDirReviewClientFactory(handleDispatcherHttpRequest);
    return factory(stateDir);
}
export async function submitReviewDecision(input) {
    return tsSubmitReviewDecision({
        ...input,
        githubToken: input.githubToken ?? process.env.GITHUB_TOKEN,
    });
}
