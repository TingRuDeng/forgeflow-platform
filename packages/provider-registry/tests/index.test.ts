import { describe, expect, it } from "vitest";

import {
  evaluateProviderAdmission,
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

  it("declares trae automation-specific permissions", () => {
    const trae = getProviderDefinition("trae");
    expect(trae.supportedPermissionKeys).toContain("automation_url");
    expect(trae.supportedModes).toContain("run");
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

  it("accepts known providers only when mode and permissions are supported", () => {
    expect(evaluateProviderAdmission({
      providerId: "codex",
      mode: "run",
      permissions: { sandbox: "workspace-write" },
    })).toMatchObject({
      ok: true,
      providerKind: "core",
      normalizedPermissions: { sandbox: "workspace-write" },
    });

    expect(evaluateProviderAdmission({
      providerId: "gemini",
      mode: "run",
      permissions: { sandbox: "workspace-write" },
    })).toMatchObject({
      ok: false,
      reasonCode: "unsupported_permission",
    });
  });

  it("fails closed for third-party providers unless they are allowlisted and declare worker protocol v1", () => {
    expect(evaluateProviderAdmission({
      providerId: "local-custom",
      mode: "run",
      permissions: {},
      declaredCapabilities: ["worker-protocol-v1"],
    })).toMatchObject({
      ok: false,
      reasonCode: "third_party_not_allowlisted",
    });

    expect(evaluateProviderAdmission({
      providerId: "local-custom",
      mode: "run",
      permissions: {},
      declaredCapabilities: ["worker-protocol-v1"],
      thirdPartyAllowlist: ["local-custom"],
    })).toMatchObject({
      ok: true,
      providerKind: "third_party",
    });

    expect(evaluateProviderAdmission({
      providerId: "local-custom",
      mode: "run",
      permissions: {},
      declaredCapabilities: [],
      thirdPartyAllowlist: ["local-custom"],
    })).toMatchObject({
      ok: false,
      reasonCode: "missing_worker_protocol_v1",
    });
  });
});
