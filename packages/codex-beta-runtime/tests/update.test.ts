import { describe, expect, it, vi } from "vitest";

import { updateLocalCheckout } from "../src/update.js";

describe("@tingrudeng/codex-beta-runtime update", () => {
  it("defaults global updates to the beta dist-tag", async () => {
    const execFile = vi.fn(async (_cmd: string, args: string[]) => {
      if (args[0] === "list") {
        return {
          stdout: JSON.stringify({
            dependencies: {
              "@tingrudeng/codex-beta-runtime": { version: "0.1.0-beta.3" },
            },
          }),
          stderr: "",
        };
      }
      return { stdout: "updated", stderr: "" };
    });

    const result = await updateLocalCheckout({ execFile });

    expect(result.performedCommand).toBe(
      "npm install -g @tingrudeng/codex-beta-runtime@beta",
    );
    expect(result.installedVersion).toBe("0.1.0-beta.3");
    expect(execFile).toHaveBeenCalledWith("npm", [
      "install",
      "-g",
      "@tingrudeng/codex-beta-runtime@beta",
    ]);
  });

  it("keeps explicit dist-tag overrides available", async () => {
    const execFile = vi.fn(async () => ({ stdout: "{}", stderr: "" }));

    const result = await updateLocalCheckout({
      defaultBranch: "next",
      installedVersion: "0.1.0-beta.3",
      execFile,
    });

    expect(result.performedCommand).toBe(
      "npm install -g @tingrudeng/codex-beta-runtime@next",
    );
  });
});
