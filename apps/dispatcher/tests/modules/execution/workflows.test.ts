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
    expect(releaseWorkflow.match(/pnpm audit --prod --audit-level high/g)?.length).toBe(1);
  });

  it("checks runtime package readiness in CI and release workflows", () => {
    const ciWorkflow = readWorkflow("ci.yml");
    const releaseWorkflow = readWorkflow("release.yml");

    expect(ciWorkflow).toContain("Verify runtime package readiness");
    expect(ciWorkflow).toContain("pnpm verify:runtime-packages");
    expect(ciWorkflow).toContain("pnpm verify:runtime-packages:install");
    expect(releaseWorkflow.match(/run: pnpm verify:runtime-packages$/gm)?.length).toBe(1);
    expect(releaseWorkflow.match(/run: pnpm verify:runtime-packages:install$/gm)?.length).toBe(1);
  });

  it("checks deprecated entrypoints through the shared root script in CI and release workflows", () => {
    const ciWorkflow = readWorkflow("ci.yml");
    const releaseWorkflow = readWorkflow("release.yml");
    const packageJson = fs.readFileSync(path.join(repoRoot, "package.json"), "utf8");
    const scripts = JSON.parse(packageJson).scripts;

    expect(scripts["verify:deprecated-entrypoints"]).toBe("node scripts/check-deprecated-entrypoints.mjs");
    expect(ciWorkflow).toContain("Check deprecated entrypoints");
    expect(ciWorkflow).toContain("pnpm verify:deprecated-entrypoints");
    expect(releaseWorkflow.match(/run: pnpm verify:deprecated-entrypoints$/gm)?.length).toBe(1);
    expect(releaseWorkflow).not.toContain("run: node scripts/check-deprecated-entrypoints.mjs");
  });

  it("publishes only after a versioned package manifest reaches protected main", () => {
    const workflow = readWorkflow("release.yml");

    expect(workflow).not.toContain("workflow_dispatch:");
    expect(workflow).not.toContain("publish-manual:");
    expect(workflow).not.toContain('git push origin "HEAD:main"');
    expect(workflow).toContain("push:");
    expect(workflow).toContain("branches: [main]");
    expect(workflow).toContain("'packages/*/package.json'");
    expect(workflow).toContain("Require one package release per merge");
    expect(workflow).toContain("Refusing to publish multiple package versions from one main merge.");
    expect(workflow).toContain("id: publish");
    expect(workflow).toContain("Prepare exact release tarball");
    expect(workflow).toContain("scripts/prepare-release-tarball.mjs");
    expect(workflow).toContain("Verify exact registry tarball");
    expect(workflow).toContain("scripts/verify-published-package-tarball.mjs");
    expect(workflow).toContain("--expected-manifest");
    expect(workflow).toContain("--require-published-workspace-deps");
    expect(workflow).toContain("Run shadow drift gate");
    expect(workflow).toContain("pnpm verify:shadow-drift");
    expect(workflow).toContain("Verify published provider runtime smoke");
    expect(workflow).toContain("node scripts/verify-published-runtime-smoke.mjs");
    expect(workflow).toContain('--package "$RELEASE_PACKAGE"');
    expect(workflow.match(/pnpm verify:shadow-drift/g)?.length).toBe(1);
    expect(workflow.indexOf("pnpm verify:shadow-drift")).toBeLessThan(workflow.indexOf("npm publish"));
    expect(workflow.indexOf("npm publish")).toBeLessThan(workflow.indexOf('--package "$RELEASE_PACKAGE"'));
  });

  it("validates releasable package names and npm dist-tags", () => {
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
  });

  it("runs full verification before automatic npm publish", () => {
    const workflow = readWorkflow("release.yml");
    const publishAutoIndex = workflow.indexOf("publish-auto:");
    const npmPublishIndex = workflow.indexOf('npm publish "$RELEASE_TARBALL"', publishAutoIndex);

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
    const recordTagsIndex = workflow.indexOf("  record-release-tags:");
    const autoJob = workflow.slice(publishAutoIndex, recordTagsIndex);
    const autoRunSteps = workflowRunScripts(autoJob);
    expect(autoJob).toContain("RELEASE_PACKAGE: ${{ matrix.package.name }}");
    expect(autoJob).toContain("RELEASE_VERSION: ${{ matrix.package.version }}");
    expect(autoRunSteps).not.toMatch(/\$\{\{\s*matrix\.package\.(?:name|version)\s*\}\}/);
    expect(autoRunSteps).not.toContain("${{ steps.preflight.outputs.dist_tag }}");
    expect(autoRunSteps).toContain(
      'npm publish "$RELEASE_TARBALL" --ignore-scripts --access public --provenance --tag "$NPM_DIST_TAG"',
    );
  });

  it("records idempotent release tags in a separate least-privilege job", () => {
    const workflow = readWorkflow("release.yml");
    const publishAutoIndex = workflow.indexOf("  publish-auto:");
    const recordTagsIndex = workflow.indexOf("  record-release-tags:");
    const autoJob = workflow.slice(publishAutoIndex, recordTagsIndex);
    const tagJob = workflow.slice(recordTagsIndex);

    expect(recordTagsIndex).toBeGreaterThan(publishAutoIndex);
    expect(autoJob).toContain("contents: read");
    expect(autoJob).toContain("id-token: write");
    expect(autoJob).not.toContain("contents: write");
    expect(tagJob).toContain("needs: [detect-changes, publish-auto]");
    expect(tagJob).toContain("contents: write");
    expect(tagJob).not.toContain("id-token: write");
    expect(tagJob).toContain('RELEASE_TAG="release/${RELEASE_PACKAGE}@${RELEASE_VERSION}"');
    expect(tagJob).toContain('git rev-list -n 1 "$RELEASE_TAG"');
    expect(tagJob).toContain('git push origin "refs/tags/${RELEASE_TAG}"');
  });

  it("pins every third-party action to a full commit SHA and uses least-privilege defaults", () => {
    for (const workflowName of ["ci.yml", "release.yml", "release-scorecard.yml", "stage3-drill.yml"]) {
      const workflow = readWorkflow(workflowName);
      const usesLines = workflow.split("\n").filter((line) => line.trimStart().startsWith("uses:"));

      expect(usesLines.length).toBeGreaterThan(0);
      for (const line of usesLines) {
        expect(line).toMatch(/uses:\s+[^@\s]+@[0-9a-f]{40}\s+#\s+v\d+/);
      }
    }

    expect(readWorkflow("ci.yml")).toMatch(/permissions:\n  contents: read/);
    expect(readWorkflow("stage3-drill.yml")).toMatch(/permissions:\n  contents: read/);
    const dependabot = fs.readFileSync(path.join(repoRoot, ".github", "dependabot.yml"), "utf8");
    expect(dependabot).toContain("package-ecosystem: github-actions");
    expect(dependabot).toContain("interval: weekly");
  });

  it("serializes all releases and binds automatic publish to the detected commit and version", () => {
    const workflow = readWorkflow("release.yml");
    const publishAutoIndex = workflow.indexOf("publish-auto:");
    const autoJob = workflow.slice(publishAutoIndex, workflow.indexOf("  record-release-tags:"));

    expect(workflow).toContain("group: release-${{ github.repository }}");
    expect(workflow).not.toContain("group: release-${{ github.ref_name }}");
    expect(workflow).toContain("release-sha: ${{ steps.detect.outputs.release-sha }}");
    expect(workflow).toContain('echo "release-sha=$GITHUB_SHA"');
    expect(autoJob).toContain("ref: ${{ needs.detect-changes.outputs.release-sha }}");
    expect(autoJob).toContain("Verify detected release identity");
    expect(autoJob).toContain('[[ "$CURRENT_SHA" != "$RELEASE_SHA" ]]');
    expect(autoJob).toContain('[[ "$CURRENT_VERSION" != "$RELEASE_VERSION" ]]');
    expect(autoJob).toContain('[[ "$RELEASE_VERSION" == *-* ]]');
    expect(autoJob).toContain("EXPECTED_DIST_TAG=beta");
    expect(autoJob).toContain("EXPECTED_DIST_TAG=latest");
    expect(autoJob).toContain('validate-release-inputs.mjs "$RELEASE_PACKAGE" "$EXPECTED_DIST_TAG"');
  });

  it("publishes and verifies one prepared tarball before recording its release tag", () => {
    const workflow = readWorkflow("release.yml");

    expect(workflow.match(/name: Prepare exact release tarball/g)?.length).toBe(1);
    expect(workflow.match(/name: Require unchanged main and publish exact tarball/g)?.length).toBe(1);
    expect(workflow.match(/name: Verify main remained unchanged during publish/g)?.length).toBe(1);
    expect(workflow.match(/name: Verify exact registry tarball/g)?.length).toBe(1);
    expect(workflow.match(/scripts\/prepare-release-tarball\.mjs/g)?.length).toBe(1);
    expect(workflow.match(/scripts\/verify-published-package-tarball\.mjs/g)?.length).toBe(1);
    expect(workflow.match(/npm publish "\$RELEASE_TARBALL" --ignore-scripts/g)?.length).toBe(1);
    expect(workflow.match(/git fetch --no-tags origin main/g)?.length).toBe(2);
    expect(workflow.match(/\[\[ "\$REMOTE_MAIN" != "\$RELEASE_SHA" \]\]/g)?.length).toBe(2);
    expect(workflow).toContain("Summarize automatic post-publish recovery");
    expect(workflow.match(/steps\.publish\.outcome == 'success'/g)?.length).toBe(1);
    expect(workflow.match(/package-manager-cache: false/g)?.length).toBe(2);
    expect(workflow).not.toContain("cache: pnpm");
    expect(workflow).toContain('--expected-dist-tag "$EXPECTED_DIST_TAG"');
    expect(workflow.match(/--expected-dist-tag/g)?.length).toBe(1);
  });

  it("runs release scorecard only after a successful Release workflow and pins its checkout SHA", () => {
    const workflow = readWorkflow("release-scorecard.yml");

    expect(workflow).toContain('workflows: ["Release"]');
    expect(workflow).toContain("if: github.event.workflow_run.conclusion == 'success'");
    expect(workflow).toContain("ref: ${{ github.event.workflow_run.head_sha }}");
    expect(workflow).toContain("persist-credentials: false");
  });

  it("fails releases unless npm confirms the exact version is available", () => {
    const workflow = readWorkflow("release.yml");
    const publishAutoIndex = workflow.indexOf("publish-auto:");
    const autoJob = workflow.slice(publishAutoIndex, workflow.indexOf("  record-release-tags:"));

    expect(autoJob).toContain("--require-version-available");
    expect(workflow.match(/--require-version-available/g)?.length).toBe(1);
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
    expect(workflow.match(/--require-package-exists/g)?.length).toBe(1);
    expect(workflow.match(/--require-published-workspace-deps/g)?.length).toBe(1);
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
