import { describe, expect, it } from "vitest";

import {
  getProviderDefinition,
  normalizePermissions,
} from "../src/index.js";

describe("provider registry", () => {
  it("declares codex sandbox support", () => {
    const codex = getProviderDefinition("codex");
    expect(codex.supportedPermissionKeys).toContain("sandbox");
  });

  it("declares gemini with no sandbox support", () => {
    const gemini = getProviderDefinition("gemini");
    expect(gemini.supportedPermissionKeys).not.toContain("sandbox");
  });

  it("fails closed in strict mode for unsupported permissions", () => {
    expect(() =>
      normalizePermissions("gemini", { sandbox: "workspace-write" }, "strict"),
    ).toThrow("permission_enforcement_failed");
  });

  it("drops unsupported permissions in best_effort mode", () => {
    expect(
      normalizePermissions("gemini", { sandbox: "workspace-write" }, "best_effort"),
    ).toEqual({});
  });
});
