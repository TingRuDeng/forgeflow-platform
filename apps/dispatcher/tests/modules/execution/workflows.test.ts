import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);

function readWorkflow(name: string): string {
  return fs.readFileSync(path.join(repoRoot, ".github", "workflows", name), "utf8");
}

describe("workflow quality gates", () => {
  it("runs documentation validation in CI", () => {
    const workflow = readWorkflow("ci.yml");

    expect(workflow).toContain("pnpm docs:validate");
  });

  it("checks runtime package readiness in CI and release workflows", () => {
    const ciWorkflow = readWorkflow("ci.yml");
    const releaseWorkflow = readWorkflow("release.yml");

    expect(ciWorkflow).toContain("Verify runtime package readiness");
    expect(ciWorkflow).toContain("pnpm verify:runtime-packages");
    expect(ciWorkflow).toContain("pnpm verify:runtime-packages:install");
    expect(releaseWorkflow.match(/run: pnpm verify:runtime-packages$/gm)?.length).toBe(2);
    expect(releaseWorkflow.match(/run: pnpm verify:runtime-packages:install$/gm)?.length).toBe(2);
  });

  it("publishes manual releases before recording git version history", () => {
    const workflow = readWorkflow("release.yml");

    expect(workflow).toMatch(/contents:\s+write/);
    expect(workflow).toMatch(/issues:\s+write/);
    expect(workflow).toContain("id: publish");
    expect(workflow).toContain("release-package-json-before-publish");
    expect(workflow).toContain("git commit");
    expect(workflow).toContain("git tag");
    expect(workflow).toContain("git push");
    expect(workflow).toContain("手动发布需要恢复");
    expect(workflow).toContain("创建发布后 git 恢复 issue");
    expect(workflow).toContain("gh issue create");
    expect(workflow).toContain("Run shadow drift gate");
    expect(workflow).toContain("pnpm verify:shadow-drift");
    expect(workflow.match(/pnpm verify:shadow-drift/g)?.length).toBe(2);
    expect(workflow.indexOf("pnpm verify:shadow-drift")).toBeLessThan(workflow.indexOf("npm publish"));
    expect(workflow.indexOf("npm publish")).toBeLessThan(workflow.indexOf("git push"));
  });

  it("runs full verification before automatic npm publish", () => {
    const workflow = readWorkflow("release.yml");
    const publishAutoIndex = workflow.indexOf("publish-auto:");
    const npmPublishIndex = workflow.indexOf("npm publish --access public --provenance", publishAutoIndex);

    expect(publishAutoIndex).toBeGreaterThanOrEqual(0);
    expect(npmPublishIndex).toBeGreaterThan(publishAutoIndex);
    for (const gate of [
      "Run lint",
      "Validate docs",
      "Run typecheck",
      "Run tests",
      "Run shadow drift gate",
    ]) {
      const gateIndex = workflow.indexOf(gate, publishAutoIndex);
      expect(gateIndex).toBeGreaterThan(publishAutoIndex);
      expect(gateIndex).toBeLessThan(npmPublishIndex);
    }
  });

  it("keeps brand-new npm package names out of the automatic publish matrix", () => {
    const workflow = readWorkflow("release.yml");
    const packageExistsIndex = workflow.indexOf('npm view "${pkg_name}" version');
    const versionExistsIndex = workflow.indexOf('npm view "${pkg_name}@${local_version}" version');
    const setupSummaryIndex = workflow.indexOf("publish-setup-required-summary:");
    const publishAutoIndex = workflow.indexOf("publish-auto:");

    expect(workflow).toContain("new-packages");
    expect(workflow).toContain("has-new-packages");
    expect(workflow).toContain("自动发布等待 npm 包名配置");
    expect(packageExistsIndex).toBeGreaterThanOrEqual(0);
    expect(versionExistsIndex).toBeGreaterThan(packageExistsIndex);
    expect(setupSummaryIndex).toBeGreaterThan(packageExistsIndex);
    expect(setupSummaryIndex).toBeLessThan(publishAutoIndex);
    expect(workflow.match(/--require-package-exists/g)?.length).toBe(2);
  });

  it("runs shadow drift as part of the stage3 rollout gate", () => {
    const packageJson = fs.readFileSync(path.join(repoRoot, "package.json"), "utf8");
    const scripts = JSON.parse(packageJson).scripts;

    expect(scripts["verify:stage3"]).toContain("pnpm verify:shadow-drift");
    expect(scripts["verify:shadow-drift"]).toBe("node scripts/check-shadow-drift.mjs .forgeflow-dispatcher");
    expect(scripts["verify:shadow-drift:reconcile"]).toBe("node scripts/check-shadow-drift.mjs .forgeflow-dispatcher --reconcile --record-alert");
    expect(scripts["verify:shadow-drift:reconciler"]).toBe(
      "node scripts/run-shadow-reconciler.mjs .forgeflow-dispatcher --output .forgeflow-dispatcher/shadow-reconciler-status.json",
    );
    expect(scripts["verify:shadow-cutover"]).toBe("node scripts/check-shadow-drift.mjs .forgeflow-dispatcher --require-configured --require-primary-backend --max-mismatches 0 --max-delta 0");
    expect(scripts["verify:shadow-cutover:reconciler"]).toBe(
      "node scripts/run-shadow-reconciler.mjs .forgeflow-dispatcher --output .forgeflow-dispatcher/shadow-reconciler-status.json --require-configured --require-primary-backend --max-mismatches 0 --max-delta 0",
    );
    expect(scripts["verify:shadow-cutover:approve"]).toBe(
      "node scripts/approve-shadow-cutover.mjs .forgeflow-dispatcher --evidence .forgeflow-dispatcher/shadow-cutover-drill.json",
    );
    expect(scripts["verify:shadow-cutover:approval"]).toBe(
      "node scripts/verify-shadow-cutover-approval.mjs .forgeflow-dispatcher",
    );
    expect(scripts["verify:shadow-cutover:ready"]).toBe(
      "node scripts/verify-shadow-cutover-ready.mjs .forgeflow-dispatcher",
    );
    expect(scripts["verify:shadow-cutover:ready:evidence"]).toBe(
      "node scripts/verify-shadow-cutover-ready.mjs .forgeflow-dispatcher --output .forgeflow-dispatcher/shadow-cutover-ready.json",
    );
    expect(scripts["verify:shadow-cutover:complete"]).toBe(
      "node scripts/verify-shadow-cutover-complete.mjs .forgeflow-dispatcher",
    );
    expect(scripts["verify:shadow-cutover:complete:evidence"]).toBe(
      "node scripts/verify-shadow-cutover-complete.mjs .forgeflow-dispatcher --output .forgeflow-dispatcher/shadow-cutover-complete.json",
    );
    expect(scripts["verify:shadow-cutover:revoke"]).toBe(
      "node scripts/revoke-shadow-cutover.mjs .forgeflow-dispatcher --reason operator_rollback",
    );
  });
});
