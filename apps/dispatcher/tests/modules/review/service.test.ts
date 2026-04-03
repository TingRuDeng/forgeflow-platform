import { describe, expect, it } from "vitest";

import { ReviewService } from "../../../src/modules/review/service.js";

describe("ReviewService", () => {
  it("requires worker self-verification before review material can be collected", () => {
    const service = new ReviewService();

    expect(() =>
      service.collectReviewMaterial({
        repo: "org/repo-a",
        title: "feat: auth api",
        changedFiles: ["apps/api/auth.ts"],
        selfTestPassed: false,
        checks: ["ai-ci"],
      }),
    ).toThrow("review_requires_self_test");
  });

  it("accepts review findings only when they satisfy the contract", () => {
    const service = new ReviewService();

    const findings = service.requestStructuredReview([
      {
        finding_id: "f-1",
        severity: "high",
        category: "bug",
        title: "Missing auth check",
        evidence: {
          file: "apps/api/auth.ts",
          line: 12,
          symbol: "authenticate",
          snippet: "return true;",
        },
        recommendation: "Add token validation before returning success.",
        confidence: 0.91,
        fingerprint: "auth-12",
        detected_by: ["codex-control"],
      },
    ]);

    expect(findings).toHaveLength(1);
    expect(() =>
      service.requestStructuredReview([
        {
          severity: "high",
        },
      ]),
    ).toThrow();
  });

  it("rejects merge when ci has not passed", () => {
    const service = new ReviewService();

    const ready = service.isMergeReady({
      selfTestPassed: true,
      ciPassed: false,
      findings: [],
    });

    expect(ready).toEqual({
      ready: false,
      reasons: ["ci_failed"],
    });
  });

  it("renders markdown pull request summaries", () => {
    const service = new ReviewService();

    const markdown = service.renderMarkdownPr({
      title: "feat: auth api",
      summary: ["implement auth api", "add token validation"],
      checks: ["ai-ci", "ai-verify-merge"],
      findings: [],
    });

    expect(markdown.body).toContain("# feat: auth api");
    expect(markdown.body).toContain("- implement auth api");
    expect(markdown.body).toContain("- ai-ci");
  });

  it("renders placeholder content when summary is empty", () => {
    const service = new ReviewService();

    const markdown = service.renderMarkdownPr({
      title: "feat: auth api",
      summary: [],
      checks: ["ai-ci"],
      findings: [],
    });

    expect(markdown.body).toContain("- (no summary provided)");
    expect(markdown.body).toContain("- ai-ci");
  });

  it("renders placeholder content when checks is empty", () => {
    const service = new ReviewService();

    const markdown = service.renderMarkdownPr({
      title: "feat: auth api",
      summary: ["implement auth api"],
      checks: [],
      findings: [],
    });

    expect(markdown.body).toContain("- implement auth api");
    expect(markdown.body).toContain("- (no checks provided)");
  });

  it("renders placeholder content when both summary and checks are empty", () => {
    const service = new ReviewService();

    const markdown = service.renderMarkdownPr({
      title: "feat: auth api",
      summary: [],
      checks: [],
      findings: [],
    });

    expect(markdown.body).toContain("- (no summary provided)");
    expect(markdown.body).toContain("- (no checks provided)");
  });

  it("filters out empty check entries to avoid empty bullets", () => {
    const service = new ReviewService();

    const markdown = service.renderMarkdownPr({
      title: "feat: auth api",
      summary: ["implement auth api"],
      checks: ["ai-ci", "", "  ", "ai-verify-merge"],
      findings: [],
    });

    expect(markdown.body).toContain("- implement auth api");
    expect(markdown.body).toContain("- ai-ci");
    expect(markdown.body).toContain("- ai-verify-merge");
    expect(markdown.body).not.toContain("- (no checks provided)");
    expect(markdown.body).not.toMatch(/- $/m);
  });

  it("renders placeholder when all checks are empty strings", () => {
    const service = new ReviewService();

    const markdown = service.renderMarkdownPr({
      title: "feat: auth api",
      summary: ["implement auth api"],
      checks: ["", "  ", ""],
      findings: [],
    });

    expect(markdown.body).toContain("- implement auth api");
    expect(markdown.body).toContain("- (no checks provided)");
  });
});
