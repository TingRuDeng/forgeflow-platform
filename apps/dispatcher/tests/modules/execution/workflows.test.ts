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

  it("runs shadow drift as part of the stage3 rollout gate", () => {
    const packageJson = fs.readFileSync(path.join(repoRoot, "package.json"), "utf8");
    const scripts = JSON.parse(packageJson).scripts;

    expect(scripts["verify:stage3"]).toContain("pnpm verify:shadow-drift");
    expect(scripts["verify:shadow-drift"]).toBe("node scripts/check-shadow-drift.mjs .forgeflow-dispatcher");
  });
});
