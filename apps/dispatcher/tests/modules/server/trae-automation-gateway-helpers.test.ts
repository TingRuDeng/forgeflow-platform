import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);
const helperModulePath = path.join(repoRoot, "scripts/lib/trae-automation-gateway-helpers.js");

describe("trae automation gateway helpers", () => {
  it("builds discovery filters from query params", async () => {
    const mod = await import(helperModulePath);

    expect(mod.parseDiscoveryFromQuery({
      title_contains: "Trae, Workspace ",
      url_contains: "trae.ai, /chat ",
    })).toEqual({
      titleContains: ["Trae", "Workspace"],
      urlContains: ["trae.ai", "/chat"],
    });

    expect(mod.parseDiscoveryFromQuery({})).toBeNull();
  });

  it("detects timeout-shaped errors", async () => {
    const mod = await import(helperModulePath);

    expect(mod.isTimeoutError({ code: "AUTOMATION_RESPONSE_TIMEOUT" })).toBe(true);
    expect(mod.isTimeoutError(new Error("Request timeout while waiting"))).toBe(true);
    expect(mod.isTimeoutError(new Error("different error"))).toBe(false);
  });

  it("normalizes unknown errors into ApiError instances", async () => {
    const mod = await import(helperModulePath);
    const normalized = mod.normalizeApiError(new Error("boom"));

    expect(normalized).toBeInstanceOf(mod.ApiError);
    expect(normalized.code).toBe("INTERNAL_ERROR");
    expect(normalized.statusCode).toBe(500);
    expect(normalized.message).toBe("boom");
  });
});
