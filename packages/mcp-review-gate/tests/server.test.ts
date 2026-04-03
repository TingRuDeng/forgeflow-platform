import { describe, expect, it, vi } from "vitest";

import { createReviewGateServer } from "../src/server.js";

describe("mcp review gate server", () => {
  it("delegates findings submission and merge readiness checks", async () => {
    const submitFindings = vi.fn().mockResolvedValue({ stored: 2 });
    const checkMergeReadiness = vi.fn().mockResolvedValue({
      ready: false,
      reasons: ["ci_failed"],
    });
    const renderMarkdownPr = vi.fn().mockResolvedValue({
      body: "## Summary\n- auth api",
    });
    const server = createReviewGateServer({
      submitFindings,
      checkMergeReadiness,
      renderMarkdownPr,
    });

    const findings = await server.callTool("submit_findings", {
      reviewId: "review-1",
      findings: [
        { path: "apps/api/auth.ts", severity: "high", summary: "Missing auth check" },
        { path: "apps/api/token.ts", severity: "medium", summary: "No expiry validation" },
      ],
    });
    const readiness = await server.callTool("check_merge_readiness", {
      repo: "org/repo-a",
      number: 42,
    });
    const markdown = await server.callTool("render_markdown_pr", {
      title: "feat: auth api",
      summary: ["implement auth api"],
      checks: ["ai-ci"],
    });

    expect(submitFindings).toHaveBeenCalledWith({
      reviewId: "review-1",
      findings: [
        { path: "apps/api/auth.ts", severity: "high", summary: "Missing auth check" },
        { path: "apps/api/token.ts", severity: "medium", summary: "No expiry validation" },
      ],
    });
    expect(checkMergeReadiness).toHaveBeenCalledWith({
      repo: "org/repo-a",
      number: 42,
    });
    expect(renderMarkdownPr).toHaveBeenCalledWith({
      title: "feat: auth api",
      summary: ["implement auth api"],
      checks: ["ai-ci"],
    });
    expect(findings).toEqual({ stored: 2 });
    expect(readiness).toEqual({
      ready: false,
      reasons: ["ci_failed"],
    });
    expect(markdown).toEqual({
      body: "## Summary\n- auth api",
    });
  });
});
