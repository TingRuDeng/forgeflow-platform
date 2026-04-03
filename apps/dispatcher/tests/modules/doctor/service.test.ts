import { describe, expect, it } from "vitest";

import { DoctorService } from "../../../src/modules/doctor/service.js";

describe("DoctorService", () => {
  it("reports provider readiness and project compatibility", async () => {
    const doctor = new DoctorService(async (provider) => {
      if (provider === "codex") {
        return {
          detected: true,
          authOk: true,
          version: "0.1.0",
        };
      }

      return {
        detected: false,
        authOk: false,
        version: null,
      };
    });

    const result = await doctor.check({
      enabledProviders: ["codex", "gemini"],
      requiredPermissions: {
        codex: { sandbox: "workspace-write" },
        gemini: {},
      },
    });

    expect(result.overallOk).toBe(false);
    expect(result.providers.codex.ready).toBe(true);
    expect(result.providers.gemini.ready).toBe(false);
  });
});
