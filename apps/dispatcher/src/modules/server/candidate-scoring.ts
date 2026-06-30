// Deterministic candidate scoring.
//
// Foundation for competitive worker selection: given several candidate results
// for the same task, rank them with a deterministic, explainable function — never
// an LLM judge. The scoring inputs intentionally mirror what a human reviewer
// would weigh first: did verification pass, how blast-radius-heavy is the change,
// did it add tests, and did it touch protected paths.
//
// NOTE: This module only ranks already-produced candidates. Running multiple
// workers on the same task in parallel (true competitive execution) remains
// deferred under the current Trae-first, single-task-serial runtime; see
// docs/TECH_DEBT.md. Today this primitive is useful for ranking redrive attempts
// or any externally collected set of candidate results.

import { DEFAULT_PROTECTED_PATHS, matchesAnyPattern } from "./review-risk.js";

export interface CandidateInput {
  candidateId: string;
  verificationPassed: boolean;
  changedFiles: string[];
}

export interface CandidateScoreBreakdown {
  verification: number;
  testCoverage: number;
  changeSize: number;
  protectedPaths: number;
}

export interface CandidateScore {
  candidateId: string;
  score: number;
  verificationPassed: boolean;
  changedFileCount: number;
  testFilesAdded: number;
  protectedPathHits: number;
  breakdown: CandidateScoreBreakdown;
  reasons: string[];
}

export interface CandidateScoringConfig {
  protectedPaths: string[];
  // Weights are deterministic and explainable; tune if needed.
  verificationWeight: number;
  testFileWeight: number;
  changeSizePenaltyPerFile: number;
  protectedPathPenalty: number;
}

export const DEFAULT_CANDIDATE_SCORING_CONFIG: CandidateScoringConfig = {
  protectedPaths: [...DEFAULT_PROTECTED_PATHS],
  verificationWeight: 1000,
  testFileWeight: 5,
  changeSizePenaltyPerFile: 1,
  protectedPathPenalty: 20,
};

const TEST_FILE_PATTERNS = [
  "**/*.test.*",
  "**/*.spec.*",
  "**/*_test.*",
  "**/test_*.*",
  "**/tests/**",
  "**/__tests__/**",
];

function normalizeFiles(files: string[]): string[] {
  return (files ?? [])
    .map((file) => file.trim())
    .filter((file) => file.length > 0);
}

export function isTestFile(filePath: string): boolean {
  return matchesAnyPattern(filePath, TEST_FILE_PATTERNS);
}

export function scoreCandidate(
  input: CandidateInput,
  config: CandidateScoringConfig = DEFAULT_CANDIDATE_SCORING_CONFIG,
): CandidateScore {
  const changedFiles = normalizeFiles(input.changedFiles);
  const changedFileCount = changedFiles.length;
  const testFilesAdded = changedFiles.filter((file) => isTestFile(file)).length;
  const protectedPathHits = changedFiles.filter((file) =>
    matchesAnyPattern(file, config.protectedPaths),
  ).length;

  const breakdown: CandidateScoreBreakdown = {
    verification: input.verificationPassed ? config.verificationWeight : 0,
    testCoverage: testFilesAdded * config.testFileWeight,
    changeSize: -changedFileCount * config.changeSizePenaltyPerFile,
    protectedPaths: -protectedPathHits * config.protectedPathPenalty,
  };

  const score =
    breakdown.verification +
    breakdown.testCoverage +
    breakdown.changeSize +
    breakdown.protectedPaths;

  const reasons: string[] = [];
  reasons.push(input.verificationPassed ? "verification passed" : "verification failed");
  if (testFilesAdded > 0) {
    reasons.push(`${testFilesAdded} test file(s) touched`);
  }
  reasons.push(`${changedFileCount} changed file(s)`);
  if (protectedPathHits > 0) {
    reasons.push(`${protectedPathHits} protected-path change(s)`);
  }

  return {
    candidateId: input.candidateId,
    score,
    verificationPassed: input.verificationPassed,
    changedFileCount,
    testFilesAdded,
    protectedPathHits,
    breakdown,
    reasons,
  };
}

// Ranks candidates highest score first. Ties break deterministically by
// candidateId so the ordering is stable and reproducible across runs.
export function rankCandidates(
  inputs: CandidateInput[],
  config: CandidateScoringConfig = DEFAULT_CANDIDATE_SCORING_CONFIG,
): CandidateScore[] {
  return inputs
    .map((input) => scoreCandidate(input, config))
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.candidateId.localeCompare(b.candidateId);
    });
}
