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

  it("records manual release version bumps in git history before publishing", () => {
    const workflow = readWorkflow("release.yml");

    expect(workflow).toMatch(/contents:\s+write/);
    expect(workflow).toContain("git commit");
    expect(workflow).toContain("git tag");
    expect(workflow).toContain("git push");
    expect(workflow.indexOf("git push")).toBeLessThan(workflow.indexOf("npm publish"));
  });
});
