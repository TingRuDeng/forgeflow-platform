import {
  ReviewFindingSchema,
  type ReviewFinding,
} from "@forgeflow/result-contracts";
import { z } from "zod";

const ReviewFindingListSchema = z.array(ReviewFindingSchema);

export interface ReviewMaterialInput {
  repo: string;
  title: string;
  changedFiles: string[];
  selfTestPassed: boolean;
  checks: string[];
}

export interface MergeReadinessInput {
  selfTestPassed: boolean;
  ciPassed: boolean;
  findings: ReviewFinding[];
}

export interface RenderMarkdownPrInput {
  title: string;
  summary: string[];
  checks: string[];
  findings: ReviewFinding[];
}

export class ReviewService {
  collectReviewMaterial(input: ReviewMaterialInput): ReviewMaterialInput {
    if (!input.selfTestPassed) {
      throw new Error("review_requires_self_test");
    }

    return input;
  }

  requestStructuredReview(findings: unknown[]): ReviewFinding[] {
    return ReviewFindingListSchema.parse(findings);
  }

  isMergeReady(input: MergeReadinessInput): { ready: boolean; reasons: string[] } {
    const reasons: string[] = [];

    if (!input.selfTestPassed) {
      reasons.push("self_test_failed");
    }
    if (!input.ciPassed) {
      reasons.push("ci_failed");
    }
    if (input.findings.length > 0) {
      reasons.push("review_findings_present");
    }

    return {
      ready: reasons.length === 0,
      reasons,
    };
  }

  renderMarkdownPr(input: RenderMarkdownPrInput): { body: string } {
    const summarySection =
      input.summary.length === 0
        ? "- (no summary provided)"
        : input.summary.map((item) => `- ${item}`).join("\n");
    const nonEmptyChecks = input.checks.filter((item) => item.trim() !== "");
    const checksSection =
      nonEmptyChecks.length === 0
        ? "- (no checks provided)"
        : nonEmptyChecks.map((item) => `- ${item}`).join("\n");
    const findingsSection =
      input.findings.length === 0
        ? "- none"
        : input.findings.map((finding) => `- ${finding.severity}: ${finding.title}`).join("\n");

    return {
      body: [
        `# ${input.title}`,
        "",
        "## Summary",
        summarySection,
        "",
        "## Checks",
        checksSection,
        "",
        "## Findings",
        findingsSection,
      ].join("\n"),
    };
  }
}
