import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);

function readWorkflow(name: string): string {
  return fs.readFileSync(path.join(repoRoot, ".github", "workflows", name), "utf8");
}

function manualReleaseJob(workflow: string): string {
  const start = workflow.indexOf("  publish-manual:");
  const end = workflow.indexOf("\n  publish-disabled-summary:", start);
  return workflow.slice(start, end);
}

function workflowRunScripts(job: string): string {
  const scripts: string[] = [];
  let inRunBlock = false;

  for (const line of job.split("\n")) {
    const runMatch = line.match(/^        run:\s*(.*)$/);
    if (runMatch) {
      inRunBlock = true;
      scripts.push(runMatch[1]);
      continue;
    }

    if (inRunBlock && (line.startsWith("          ") || line.length === 0)) {
      scripts.push(line);
      continue;
    }

    inRunBlock = false;
  }

  return scripts.join("\n");
}

describe("workflow quality gates", () => {
  it("runs documentation validation in CI", () => {
    const workflow = readWorkflow("ci.yml");

    expect(workflow).toContain("pnpm docs:validate");
  });

  it("runs Console lint and production dependency audit in CI and release workflows", () => {
    const ciWorkflow = readWorkflow("ci.yml");
    const releaseWorkflow = readWorkflow("release.yml");
    const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));

    expect(packageJson.scripts.lint).toContain("pnpm --filter console lint");
    expect(ciWorkflow).toContain("Audit production dependencies");
    expect(ciWorkflow).toContain("pnpm audit --prod --audit-level high");
    expect(releaseWorkflow.match(/pnpm audit --prod --audit-level high/g)?.length).toBe(2);
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

  it("checks deprecated entrypoints through the shared root script in CI and release workflows", () => {
    const ciWorkflow = readWorkflow("ci.yml");
    const releaseWorkflow = readWorkflow("release.yml");
    const packageJson = fs.readFileSync(path.join(repoRoot, "package.json"), "utf8");
    const scripts = JSON.parse(packageJson).scripts;

    expect(scripts["verify:deprecated-entrypoints"]).toBe("node scripts/check-deprecated-entrypoints.mjs");
    expect(ciWorkflow).toContain("Check deprecated entrypoints");
    expect(ciWorkflow).toContain("pnpm verify:deprecated-entrypoints");
    expect(releaseWorkflow.match(/run: pnpm verify:deprecated-entrypoints$/gm)?.length).toBe(2);
    expect(releaseWorkflow).not.toContain("run: node scripts/check-deprecated-entrypoints.mjs");
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
    expect(workflow).toContain("--require-published-workspace-deps");
    expect(workflow).toContain("Run shadow drift gate");
    expect(workflow).toContain("pnpm verify:shadow-drift");
    expect(workflow).toContain("Verify published provider runtime smoke");
    expect(workflow).toContain("node scripts/verify-published-runtime-smoke.mjs");
    expect(workflow).toContain('--package "$RELEASE_PACKAGE"');
    expect(workflow.match(/pnpm verify:shadow-drift/g)?.length).toBe(2);
    expect(workflow.indexOf("pnpm verify:shadow-drift")).toBeLessThan(workflow.indexOf("npm publish"));
    expect(workflow.indexOf("npm publish")).toBeLessThan(workflow.indexOf("git push"));
    expect(workflow.indexOf("npm publish")).toBeLessThan(workflow.indexOf('--package "$RELEASE_PACKAGE"'));
    expect(workflow.indexOf('--package "$RELEASE_PACKAGE"')).toBeLessThan(workflow.indexOf("git commit"));
  });

  it("keeps manual release inputs out of shell expressions", () => {
    const workflow = readWorkflow("release.yml");
    const manualJob = manualReleaseJob(workflow);
    const runSteps = workflowRunScripts(manualJob);

    expect(manualJob).toContain("RELEASE_PACKAGE: ${{ inputs.package }}");
    expect(manualJob).toContain("NPM_DIST_TAG: ${{ inputs.tag }}");
    expect(manualJob).toContain("RELEASE_REF: ${{ github.ref }}");
    expect(runSteps).not.toMatch(/\$\{\{\s*inputs\.(?:package|tag|bump)\s*\}\}/);
    expect(runSteps).not.toContain("${{ github.ref }}");
    expect(runSteps).toContain('[[ "$RELEASE_REF" != "refs/heads/main" ]]');
    expect(runSteps).toContain('git push origin "HEAD:main" --follow-tags');
    expect(runSteps).toContain('validate-release-inputs.mjs "$RELEASE_PACKAGE" "$NPM_DIST_TAG"');
    expect(runSteps).toContain('npm publish --access public --provenance --tag "$NPM_DIST_TAG"');
  });

  it("checks the bumped manual release version before build and publish", () => {
    const manualJob = manualReleaseJob(readWorkflow("release.yml"));
    const bumpIndex = manualJob.indexOf("- name: Bump package version");
    const availabilityIndex = manualJob.indexOf("- name: Verify bumped version is available");
    const buildIndex = manualJob.indexOf("- name: Build package");
    const publishIndex = manualJob.indexOf("- name: Publish to npm with Trusted Publishing");

    expect(bumpIndex).toBeGreaterThanOrEqual(0);
    expect(availabilityIndex).toBeGreaterThan(bumpIndex);
    expect(buildIndex).toBeGreaterThan(availabilityIndex);
    expect(publishIndex).toBeGreaterThan(buildIndex);
    expect(manualJob.slice(availabilityIndex, buildIndex)).toContain("--require-version-available");
  });

  it("validates manual release packages and npm dist-tags", () => {
    const scriptPath = path.join(repoRoot, "scripts", "validate-release-inputs.mjs");
    const valid = spawnSync(process.execPath, [scriptPath, "trae-beta-runtime", "beta"], {
      encoding: "utf8",
    });
    const validDispatcher = spawnSync(process.execPath, [scriptPath, "forgeflow-dispatcher", "beta"], {
      encoding: "utf8",
    });
    const validOrchestrator = spawnSync(
      process.execPath,
      [scriptPath, "worker-review-orchestrator-cli", "beta"],
      { encoding: "utf8" },
    );
    const invalidPackage = spawnSync(process.execPath, [scriptPath, "console", "beta"], {
      encoding: "utf8",
    });
    const invalidTag = spawnSync(process.execPath, [scriptPath, "trae-beta-runtime", "beta;echo-pwned"], {
      encoding: "utf8",
    });

    expect(valid.status).toBe(0);
    expect(validDispatcher.status).toBe(0);
    expect(validOrchestrator.status).toBe(0);
    expect(invalidPackage.status).toBe(1);
    expect(invalidPackage.stderr).toContain("unsupported release package");
    expect(invalidTag.status).toBe(1);
    expect(invalidTag.stderr).toContain("invalid npm dist-tag");
    expect(readWorkflow("release.yml")).toContain("          - forgeflow-dispatcher");
    expect(readWorkflow("release.yml")).toContain("          - worker-review-orchestrator-cli");
  });

  it("runs full verification before automatic npm publish", () => {
    const workflow = readWorkflow("release.yml");
    const publishAutoIndex = workflow.indexOf("publish-auto:");
    const npmPublishIndex = workflow.indexOf("npm publish --access public --provenance", publishAutoIndex);

    expect(publishAutoIndex).toBeGreaterThanOrEqual(0);
    expect(npmPublishIndex).toBeGreaterThan(publishAutoIndex);
    const publishedSmokeIndex = workflow.indexOf('--package "$RELEASE_PACKAGE"', publishAutoIndex);
    expect(publishedSmokeIndex).toBeGreaterThan(npmPublishIndex);
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
    const autoJob = workflow.slice(publishAutoIndex);
    const autoRunSteps = workflowRunScripts(autoJob);
    expect(autoJob).toContain("RELEASE_PACKAGE: ${{ matrix.package.name }}");
    expect(autoJob).toContain("RELEASE_VERSION: ${{ matrix.package.version }}");
    expect(autoRunSteps).not.toMatch(/\$\{\{\s*matrix\.package\.(?:name|version)\s*\}\}/);
    expect(autoRunSteps).not.toContain("${{ steps.preflight.outputs.dist_tag }}");
    expect(autoRunSteps).toContain('npm publish --access public --provenance --tag "$NPM_DIST_TAG"');
  });

  it("fails releases unless npm confirms the exact version is available", () => {
    const workflow = readWorkflow("release.yml");
    const publishAutoIndex = workflow.indexOf("publish-auto:");
    const autoJob = workflow.slice(publishAutoIndex);
    const manualJob = manualReleaseJob(workflow);

    expect(autoJob).toContain("--require-version-available");
    expect(manualJob).toContain("--require-version-available");
    expect(workflow.match(/--require-version-available/g)?.length).toBe(2);
    expect(autoJob).not.toContain("npm view");
    expect(autoJob).not.toContain("already_published");
    expect(autoJob).not.toContain("steps.version_check.outputs");
  });

  it("keeps brand-new npm package names out of the automatic publish matrix", () => {
    const workflow = readWorkflow("release.yml");
    const detectScriptIndex = workflow.indexOf("node scripts/detect-release-packages.mjs --json --require-known");
    const setupSummaryIndex = workflow.indexOf("publish-setup-required-summary:");
    const publishAutoIndex = workflow.indexOf("publish-auto:");

    expect(workflow).toContain("new-packages");
    expect(workflow).toContain("has-new-packages");
    expect(workflow).toContain("自动发布等待 npm 包名配置");
    expect(workflow).toContain("REPORT_JSON=\"$RUNNER_TEMP/release-packages.json\"");
    expect(workflow).toContain("PACKAGES=$(jq -c '.packages' \"$REPORT_JSON\")");
    expect(workflow).toContain("NEW_PACKAGES=$(jq -c '.newPackages' \"$REPORT_JSON\")");
    expect(detectScriptIndex).toBeGreaterThanOrEqual(0);
    expect(setupSummaryIndex).toBeGreaterThan(detectScriptIndex);
    expect(setupSummaryIndex).toBeLessThan(publishAutoIndex);
    expect(workflow.match(/--require-package-exists/g)?.length).toBe(2);
    expect(workflow.match(/--require-published-workspace-deps/g)?.length).toBe(2);
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
