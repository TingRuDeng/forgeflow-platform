// Deterministic review risk grading.
//
// When a task passes verification and enters `review`, the dispatcher grades the
// candidate change with a deterministic, explainable function (no LLM judge):
//
//   - changed files touching protected paths escalate to `needs_human_attention`
//   - changes larger than a configurable file budget escalate to
//     `too_large_for_auto_review`
//
// Only `low` is auto-merge eligible. The grade is attached to the review and a
// `review_risk_flagged` event is appended whenever the grade is not `low`, so the
// control layer (and Console) get an auditable, code-backed signal instead of
// relying on a reviewer remembering to check sensitive paths or diff size.

export type ReviewRiskLevel =
  | "low"
  | "needs_human_attention"
  | "too_large_for_auto_review";

export interface ReviewProtectedPathHit {
  pattern: string;
  files: string[];
}

export interface ReviewRiskAssessment {
  level: ReviewRiskLevel;
  changedFileCount: number;
  maxChangedFiles: number;
  protectedPathHits: ReviewProtectedPathHit[];
  reasons: string[];
}

export interface ReviewRiskConfig {
  protectedPaths: string[];
  maxChangedFiles: number;
}

// Defaults mirror the protected-path safety net used by comparable orchestrators
// (auth / payments / migrations / infra / CI workflows / secret-like files).
export const DEFAULT_PROTECTED_PATHS: readonly string[] = [
  "auth/**",
  "**/auth/**",
  "payments/**",
  "**/payments/**",
  "migrations/**",
  "**/migrations/**",
  "infra/**",
  "**/infra/**",
  ".github/workflows/**",
  "**/.env*",
  "**/*secret*",
  "**/*credential*",
  "**/*permission*",
];

export const DEFAULT_MAX_CHANGED_FILES = 50;

const RISK_LEVEL_SEVERITY: Record<ReviewRiskLevel, number> = {
  low: 0,
  needs_human_attention: 1,
  too_large_for_auto_review: 2,
};

export function isAutoMergeEligible(level: ReviewRiskLevel): boolean {
  return level === "low";
}

function escalate(current: ReviewRiskLevel, next: ReviewRiskLevel): ReviewRiskLevel {
  return RISK_LEVEL_SEVERITY[next] > RISK_LEVEL_SEVERITY[current] ? next : current;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function parseProtectedPaths(value: string | undefined): string[] {
  if (value === undefined) {
    return [...DEFAULT_PROTECTED_PATHS];
  }
  const patterns = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  // An explicitly empty list disables the protected-path gate on purpose.
  return patterns;
}

export function resolveReviewRiskConfig(
  env: NodeJS.ProcessEnv = process.env,
): ReviewRiskConfig {
  return {
    protectedPaths: parseProtectedPaths(env.DISPATCHER_REVIEW_PROTECTED_PATHS),
    maxChangedFiles: parsePositiveInt(
      env.DISPATCHER_REVIEW_MAX_CHANGED_FILES,
      DEFAULT_MAX_CHANGED_FILES,
    ),
  };
}

function normalizePath(filePath: string): string {
  return filePath.trim().replace(/^\.\//, "").replace(/^\/+/, "");
}

// Minimal, deterministic glob matcher supporting `**` (any path segments,
// including none), `*` (within a single segment), and literal text. Matching is
// case-insensitive so a protected-path gate is not bypassed by casing.
function globToRegExp(pattern: string): RegExp {
  const normalized = normalizePath(pattern);
  let regex = "";
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    if (char === "*") {
      if (normalized[i + 1] === "*") {
        i += 1;
        if (normalized[i + 1] === "/") {
          i += 1;
          regex += "(?:.*/)?";
        } else {
          regex += ".*";
        }
      } else {
        regex += "[^/]*";
      }
    } else if (/[.+?^${}()|[\]\\]/.test(char)) {
      regex += `\\${char}`;
    } else {
      regex += char;
    }
  }
  return new RegExp(`^${regex}$`, "i");
}

const globCache = new Map<string, RegExp>();

function matchesPattern(filePath: string, pattern: string): boolean {
  let compiled = globCache.get(pattern);
  if (!compiled) {
    compiled = globToRegExp(pattern);
    globCache.set(pattern, compiled);
  }
  return compiled.test(normalizePath(filePath));
}

// Exported so other dispatcher modules (e.g. the dispatch quality gate) can reuse
// the same deterministic protected-path matcher instead of duplicating glob logic.
export function matchesAnyPattern(candidate: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesPattern(candidate, pattern));
}

export function assessReviewRisk(input: {
  changedFiles: string[];
  config?: ReviewRiskConfig;
}): ReviewRiskAssessment {
  const config = input.config ?? resolveReviewRiskConfig();
  const changedFiles = (input.changedFiles ?? [])
    .map((file) => normalizePath(file))
    .filter((file) => file.length > 0);
  const changedFileCount = changedFiles.length;

  const protectedPathHits: ReviewProtectedPathHit[] = [];
  for (const pattern of config.protectedPaths) {
    const files = changedFiles.filter((file) => matchesPattern(file, pattern));
    if (files.length > 0) {
      protectedPathHits.push({ pattern, files });
    }
  }

  const reasons: string[] = [];
  let level: ReviewRiskLevel = "low";

  if (protectedPathHits.length > 0) {
    level = escalate(level, "needs_human_attention");
    const patterns = protectedPathHits.map((hit) => hit.pattern).join(", ");
    reasons.push(`protected paths touched: ${patterns}`);
  }

  if (changedFileCount > config.maxChangedFiles) {
    level = escalate(level, "too_large_for_auto_review");
    reasons.push(
      `changed files ${changedFileCount} exceed auto-review budget ${config.maxChangedFiles}`,
    );
  }

  return {
    level,
    changedFileCount,
    maxChangedFiles: config.maxChangedFiles,
    protectedPathHits,
    reasons,
  };
}
