import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_CHANGED_FILES,
  assessReviewRisk,
  isAutoMergeEligible,
  resolveReviewRiskConfig,
  type ReviewRiskConfig,
} from "../../../src/modules/server/review-risk.js";

const config: ReviewRiskConfig = {
  protectedPaths: [
    "auth/**",
    "**/auth/**",
    ".github/workflows/**",
    "**/*secret*",
    "**/.env*",
  ],
  maxChangedFiles: 5,
};

describe("assessReviewRisk", () => {
  it("grades an ordinary small change as low and auto-merge eligible", () => {
    const result = assessReviewRisk({
      changedFiles: ["src/app.ts", "src/util.ts"],
      config,
    });
    expect(result.level).toBe("low");
    expect(result.protectedPathHits).toEqual([]);
    expect(result.reasons).toEqual([]);
    expect(isAutoMergeEligible(result.level)).toBe(true);
  });

  it("escalates to needs_human_attention when a protected path is touched", () => {
    const result = assessReviewRisk({
      changedFiles: ["src/app.ts", "auth/login.ts"],
      config,
    });
    expect(result.level).toBe("needs_human_attention");
    expect(result.protectedPathHits.map((hit) => hit.pattern)).toContain("auth/**");
    expect(isAutoMergeEligible(result.level)).toBe(false);
  });

  it("matches nested protected paths and secret-like files via globs", () => {
    const result = assessReviewRisk({
      changedFiles: [
        "packages/api/src/auth/token.ts",
        "config/app-secret.json",
        ".github/workflows/ci.yml",
        "service/.env.production",
      ],
      config,
    });
    expect(result.level).toBe("needs_human_attention");
    const patterns = result.protectedPathHits.map((hit) => hit.pattern);
    expect(patterns).toContain("**/auth/**");
    expect(patterns).toContain("**/*secret*");
    expect(patterns).toContain(".github/workflows/**");
    expect(patterns).toContain("**/.env*");
  });

  it("matches protected paths case-insensitively so casing cannot bypass the gate", () => {
    const result = assessReviewRisk({
      changedFiles: ["src/Config/App-SECRET.json"],
      config,
    });
    expect(result.level).toBe("needs_human_attention");
  });

  it("escalates to too_large_for_auto_review when over the file budget", () => {
    const changedFiles = Array.from({ length: 6 }, (_, i) => `src/file-${i}.ts`);
    const result = assessReviewRisk({ changedFiles, config });
    expect(result.level).toBe("too_large_for_auto_review");
    expect(result.changedFileCount).toBe(6);
    expect(result.maxChangedFiles).toBe(5);
  });

  it("keeps protected-path reasons even when size escalation dominates the level", () => {
    const changedFiles = [
      "auth/login.ts",
      ...Array.from({ length: 6 }, (_, i) => `src/file-${i}.ts`),
    ];
    const result = assessReviewRisk({ changedFiles, config });
    expect(result.level).toBe("too_large_for_auto_review");
    expect(result.protectedPathHits.length).toBeGreaterThan(0);
    expect(result.reasons.some((reason) => reason.includes("protected paths"))).toBe(true);
    expect(result.reasons.some((reason) => reason.includes("exceed auto-review budget"))).toBe(true);
  });

  it("does not let a plain file ending in a directory name match a dir glob", () => {
    const result = assessReviewRisk({
      changedFiles: ["src/deauth.ts", "docs/payments-notes.md"],
      config,
    });
    expect(result.level).toBe("low");
  });
});

describe("resolveReviewRiskConfig", () => {
  it("uses defaults when env vars are unset", () => {
    const resolved = resolveReviewRiskConfig({} as NodeJS.ProcessEnv);
    expect(resolved.maxChangedFiles).toBe(DEFAULT_MAX_CHANGED_FILES);
    expect(resolved.protectedPaths.length).toBeGreaterThan(0);
  });

  it("reads overrides from env", () => {
    const resolved = resolveReviewRiskConfig({
      DISPATCHER_REVIEW_PROTECTED_PATHS: "infra/**, secrets/**",
      DISPATCHER_REVIEW_MAX_CHANGED_FILES: "10",
    } as NodeJS.ProcessEnv);
    expect(resolved.maxChangedFiles).toBe(10);
    expect(resolved.protectedPaths).toEqual(["infra/**", "secrets/**"]);
  });

  it("treats an explicitly empty protected-path list as disabling the gate", () => {
    const resolved = resolveReviewRiskConfig({
      DISPATCHER_REVIEW_PROTECTED_PATHS: "",
    } as NodeJS.ProcessEnv);
    expect(resolved.protectedPaths).toEqual([]);
  });
});
