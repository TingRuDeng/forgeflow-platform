import { describe, expect, it } from "vitest";

import {
  DEFAULT_CANDIDATE_SCORING_CONFIG,
  isTestFile,
  rankCandidates,
  scoreCandidate,
} from "../../../src/modules/server/candidate-scoring.js";

describe("isTestFile", () => {
  it("recognizes common test file shapes", () => {
    expect(isTestFile("src/app.test.ts")).toBe(true);
    expect(isTestFile("pkg/foo.spec.js")).toBe(true);
    expect(isTestFile("tests/integration/run.ts")).toBe(true);
    expect(isTestFile("src/__tests__/util.ts")).toBe(true);
    expect(isTestFile("module/foo_test.go")).toBe(true);
    expect(isTestFile("src/app.ts")).toBe(false);
  });
});

describe("scoreCandidate", () => {
  it("scores a passing, well-tested, small change highly", () => {
    const result = scoreCandidate({
      candidateId: "worker-a",
      verificationPassed: true,
      changedFiles: ["src/app.ts", "src/app.test.ts"],
    });
    expect(result.verificationPassed).toBe(true);
    expect(result.testFilesAdded).toBe(1);
    expect(result.changedFileCount).toBe(2);
    expect(result.protectedPathHits).toBe(0);
    expect(result.score).toBeGreaterThan(1000);
  });

  it("penalizes protected-path changes", () => {
    const plain = scoreCandidate({
      candidateId: "a",
      verificationPassed: true,
      changedFiles: ["src/app.ts"],
    });
    const sensitive = scoreCandidate({
      candidateId: "b",
      verificationPassed: true,
      changedFiles: ["auth/login.ts"],
    });
    expect(sensitive.protectedPathHits).toBe(1);
    expect(sensitive.score).toBeLessThan(plain.score);
  });

  it("ranks a failing candidate below any passing candidate", () => {
    const passing = scoreCandidate({
      candidateId: "pass",
      verificationPassed: true,
      changedFiles: Array.from({ length: 40 }, (_, i) => `src/f-${i}.ts`),
    });
    const failing = scoreCandidate({
      candidateId: "fail",
      verificationPassed: false,
      changedFiles: ["src/tiny.ts"],
    });
    expect(passing.score).toBeGreaterThan(failing.score);
  });
});

describe("rankCandidates", () => {
  it("orders by score with deterministic candidateId tie-break", () => {
    const ranked = rankCandidates([
      { candidateId: "big-pass", verificationPassed: true, changedFiles: ["a.ts", "b.ts", "c.ts"] },
      { candidateId: "small-pass", verificationPassed: true, changedFiles: ["a.ts"] },
      { candidateId: "fail", verificationPassed: false, changedFiles: ["a.ts"] },
    ]);
    expect(ranked.map((c) => c.candidateId)).toEqual(["small-pass", "big-pass", "fail"]);
  });

  it("breaks exact ties deterministically by candidateId", () => {
    const ranked = rankCandidates([
      { candidateId: "z", verificationPassed: true, changedFiles: ["a.ts"] },
      { candidateId: "a", verificationPassed: true, changedFiles: ["a.ts"] },
    ]);
    expect(ranked.map((c) => c.candidateId)).toEqual(["a", "z"]);
  });

  it("prefers the candidate that added tests when change size is equal", () => {
    const ranked = rankCandidates([
      { candidateId: "no-tests", verificationPassed: true, changedFiles: ["src/a.ts", "src/b.ts"] },
      { candidateId: "with-tests", verificationPassed: true, changedFiles: ["src/a.ts", "src/a.test.ts"] },
    ]);
    expect(ranked[0]!.candidateId).toBe("with-tests");
  });

  it("uses the default config when none is provided", () => {
    expect(DEFAULT_CANDIDATE_SCORING_CONFIG.verificationWeight).toBeGreaterThan(0);
  });
});
