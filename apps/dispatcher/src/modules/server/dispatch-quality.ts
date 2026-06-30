// Server-side dispatch quality gate.
//
// Quality discipline used to live only in a dispatch-time prompt checklist, which
// agents could ignore. This moves a minimal, deterministic floor into the
// dispatcher itself: every task created through `createDispatch` is graded for
// bounded scope and verifiable acceptance, and tasks touching sensitive areas pick
// up extra (trait-style) requirements automatically.
//
// The gate is configurable:
//   - `off`     — skip grading entirely
//   - `warn`    — record findings as a `dispatch_quality_flagged` event, allow
//   - `enforce` — reject task creation when there are blocking violations
//
// Default is `warn` so the live dispatch path is not broken; operators opt into
// `enforce` once their callers consistently supply acceptance and bounded scope.

import {
  DEFAULT_PROTECTED_PATHS,
  matchesAnyPattern,
} from "./review-risk.js";

export type DispatchQualityMode = "off" | "warn" | "enforce";

export type DispatchRiskTier = "standard" | "sensitive";

export interface DispatchQualityFinding {
  code:
    | "missing_acceptance"
    | "missing_allowed_paths"
    | "unbounded_scope_sensitive";
  message: string;
}

export interface DispatchQualityResult {
  ok: boolean;
  riskTier: DispatchRiskTier;
  violations: DispatchQualityFinding[];
}

export interface DispatchQualityConfig {
  mode: DispatchQualityMode;
  requireAcceptance: boolean;
  requireAllowedPaths: boolean;
  protectedPaths: string[];
}

// Catch-all scope patterns that make a change effectively unbounded. A sensitive
// task is not allowed to ship with one of these as its only scope.
const CATCH_ALL_SCOPES = new Set(["**", "**/*", "*", ".", "./", "/"]);

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parseMode(value: string | undefined): DispatchQualityMode {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "off" || normalized === "enforce" || normalized === "warn") {
    return normalized;
  }
  return "warn";
}

function parseProtectedPaths(value: string | undefined): string[] {
  if (value === undefined) {
    return [...DEFAULT_PROTECTED_PATHS];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function resolveDispatchQualityConfig(
  env: NodeJS.ProcessEnv = process.env,
): DispatchQualityConfig {
  return {
    mode: parseMode(env.DISPATCHER_DISPATCH_QUALITY_MODE),
    requireAcceptance: parseBoolean(env.DISPATCHER_DISPATCH_REQUIRE_ACCEPTANCE, true),
    requireAllowedPaths: parseBoolean(env.DISPATCHER_DISPATCH_REQUIRE_ALLOWED_PATHS, true),
    // Sensitive-tier detection reuses the review-risk protected-path globs unless
    // explicitly overridden, so the two gates stay aligned.
    protectedPaths: parseProtectedPaths(env.DISPATCHER_REVIEW_PROTECTED_PATHS),
  };
}

function normalizeList(value: string[] | undefined): string[] {
  return (value ?? []).map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

// A scope entry like `auth/**` is probed by collapsing glob runs into a literal
// segment so it can be tested against the protected-path globs.
function scopeProbe(pattern: string): string {
  return pattern.replace(/\*+/g, "x");
}

export function isSensitiveScope(allowedPaths: string[], protectedPaths: string[]): boolean {
  if (protectedPaths.length === 0) {
    return false;
  }
  return normalizeList(allowedPaths).some(
    (pattern) =>
      matchesAnyPattern(pattern, protectedPaths) ||
      matchesAnyPattern(scopeProbe(pattern), protectedPaths),
  );
}

export function evaluateDispatchQuality(input: {
  allowedPaths: string[];
  acceptance: string[];
  config: DispatchQualityConfig;
}): DispatchQualityResult {
  const { config } = input;
  const allowedPaths = normalizeList(input.allowedPaths);
  const acceptance = normalizeList(input.acceptance);
  const violations: DispatchQualityFinding[] = [];

  const sensitive = isSensitiveScope(allowedPaths, config.protectedPaths);
  const riskTier: DispatchRiskTier = sensitive ? "sensitive" : "standard";

  // Sensitive tasks always require acceptance, even if the global flag is off.
  if ((config.requireAcceptance || sensitive) && acceptance.length === 0) {
    violations.push({
      code: "missing_acceptance",
      message: sensitive
        ? "sensitive-scope task must declare at least one acceptance criterion"
        : "task must declare at least one acceptance criterion",
    });
  }

  if (config.requireAllowedPaths && allowedPaths.length === 0) {
    violations.push({
      code: "missing_allowed_paths",
      message: "task must declare a bounded allowedPaths scope",
    });
  }

  if (sensitive && allowedPaths.every((pattern) => CATCH_ALL_SCOPES.has(pattern)) && allowedPaths.length > 0) {
    violations.push({
      code: "unbounded_scope_sensitive",
      message: "sensitive-scope task must not use a catch-all allowedPaths scope",
    });
  }

  return {
    ok: violations.length === 0,
    riskTier,
    violations,
  };
}
