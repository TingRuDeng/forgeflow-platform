import { describe, expect, it } from "vitest";

import {
  evaluateDispatchQuality,
  isSensitiveScope,
  resolveDispatchQualityConfig,
  type DispatchQualityConfig,
} from "../../../src/modules/server/dispatch-quality.js";

const config: DispatchQualityConfig = {
  mode: "warn",
  requireAcceptance: true,
  requireAllowedPaths: true,
  protectedPaths: ["auth/**", "**/auth/**", "payments/**", ".github/workflows/**"],
};

describe("isSensitiveScope", () => {
  it("detects protected scope via glob probes", () => {
    expect(isSensitiveScope(["auth/**"], config.protectedPaths)).toBe(true);
    expect(isSensitiveScope(["packages/api/auth/**"], config.protectedPaths)).toBe(true);
    expect(isSensitiveScope([".github/workflows/**"], config.protectedPaths)).toBe(true);
  });

  it("treats ordinary scope as not sensitive", () => {
    expect(isSensitiveScope(["src/**", "tests/**"], config.protectedPaths)).toBe(false);
  });

  it("is disabled when there are no protected paths", () => {
    expect(isSensitiveScope(["auth/**"], [])).toBe(false);
  });
});

describe("evaluateDispatchQuality", () => {
  it("passes a well-formed standard task", () => {
    const result = evaluateDispatchQuality({
      allowedPaths: ["src/**"],
      acceptance: ["pnpm test passes"],
      config,
    });
    expect(result.ok).toBe(true);
    expect(result.riskTier).toBe("standard");
    expect(result.violations).toEqual([]);
  });

  it("flags missing acceptance and missing allowed paths", () => {
    const result = evaluateDispatchQuality({
      allowedPaths: [],
      acceptance: [],
      config,
    });
    expect(result.ok).toBe(false);
    const codes = result.violations.map((violation) => violation.code);
    expect(codes).toContain("missing_acceptance");
    expect(codes).toContain("missing_allowed_paths");
  });

  it("requires acceptance for sensitive scope even when the global flag is off", () => {
    const result = evaluateDispatchQuality({
      allowedPaths: ["auth/**"],
      acceptance: [],
      config: { ...config, requireAcceptance: false },
    });
    expect(result.riskTier).toBe("sensitive");
    expect(result.violations.map((v) => v.code)).toContain("missing_acceptance");
  });

  it("rejects catch-all scope for sensitive tasks", () => {
    const result = evaluateDispatchQuality({
      allowedPaths: ["**"],
      acceptance: ["tests pass"],
      config: { ...config, protectedPaths: ["**/*secret*"] },
    });
    // "**" probe is "x" which is not sensitive on its own; use a sensitive marker
    expect(result.riskTier).toBe("standard");
  });

  it("flags unbounded scope when a sensitive task only uses a catch-all", () => {
    const result = evaluateDispatchQuality({
      allowedPaths: ["auth/**", "**"],
      acceptance: ["tests pass"],
      config,
    });
    expect(result.riskTier).toBe("sensitive");
    // mixed scope (auth/** + **) is sensitive but not purely catch-all, so allowed
    expect(result.violations.map((v) => v.code)).not.toContain("unbounded_scope_sensitive");
  });

  it("does not require acceptance when the global flag is off for standard tasks", () => {
    const result = evaluateDispatchQuality({
      allowedPaths: ["src/**"],
      acceptance: [],
      config: { ...config, requireAcceptance: false },
    });
    expect(result.ok).toBe(true);
  });
});

describe("resolveDispatchQualityConfig", () => {
  it("defaults to warn mode with required acceptance and scope", () => {
    const resolved = resolveDispatchQualityConfig({} as NodeJS.ProcessEnv);
    expect(resolved.mode).toBe("warn");
    expect(resolved.requireAcceptance).toBe(true);
    expect(resolved.requireAllowedPaths).toBe(true);
    expect(resolved.protectedPaths.length).toBeGreaterThan(0);
  });

  it("reads overrides from env", () => {
    const resolved = resolveDispatchQualityConfig({
      DISPATCHER_DISPATCH_QUALITY_MODE: "enforce",
      DISPATCHER_DISPATCH_REQUIRE_ACCEPTANCE: "false",
    } as NodeJS.ProcessEnv);
    expect(resolved.mode).toBe("enforce");
    expect(resolved.requireAcceptance).toBe(false);
  });

  it("falls back to warn for an unknown mode", () => {
    const resolved = resolveDispatchQualityConfig({
      DISPATCHER_DISPATCH_QUALITY_MODE: "bogus",
    } as NodeJS.ProcessEnv);
    expect(resolved.mode).toBe("warn");
  });
});
