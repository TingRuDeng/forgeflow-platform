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
    expect(workflow).toContain("id: publish");
    expect(workflow).toContain("release-package-json-before-publish");
    expect(workflow).toContain("git commit");
    expect(workflow).toContain("git tag");
    expect(workflow).toContain("git push");
    expect(workflow).toContain("Manual release recovery required");
    expect(workflow.indexOf("npm publish")).toBeLessThan(workflow.indexOf("git push"));
  });
});
