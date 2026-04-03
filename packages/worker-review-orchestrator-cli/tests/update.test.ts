import { describe, expect, it, vi } from "vitest";

import { runUpdate } from "../src/update.js";

describe("update command", () => {
  it("calls npm install -g and verifies the installed version", async () => {
    const execFile = vi.fn()
      .mockResolvedValueOnce({
        stdout: "added 1 package",
        stderr: "",
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          dependencies: {
            "@tingrudeng/worker-review-orchestrator-cli": {
              version: "0.1.0-beta.5",
            },
          },
        }),
        stderr: "",
      });

    const result = await runUpdate({
      installedVersion: "0.1.0-beta.4",
      execFile,
    });

    expect(execFile).toHaveBeenNthCalledWith(1, "npm", [
      "install",
      "-g",
      "@tingrudeng/worker-review-orchestrator-cli@latest",
    ]);
    expect(execFile).toHaveBeenNthCalledWith(2, "npm", [
      "list",
      "-g",
      "@tingrudeng/worker-review-orchestrator-cli",
      "--json",
      "--depth=0",
    ]);
    expect(result).toMatchObject({
      packageName: "@tingrudeng/worker-review-orchestrator-cli",
      previousVersion: "0.1.0-beta.4",
      installedVersion: "0.1.0-beta.5",
      performedCommand: "npm install -g @tingrudeng/worker-review-orchestrator-cli@latest",
    });
    expect(result.message).toContain("Updated the globally installed ForgeFlow review orchestrator CLI");
  });

  it("uses a custom dist-tag when defaultBranch is provided", async () => {
    const execFile = vi.fn()
      .mockResolvedValueOnce({ stdout: "", stderr: "" })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          dependencies: {
            "@tingrudeng/worker-review-orchestrator-cli": {
              version: "0.1.0-beta.5-next.1",
            },
          },
        }),
        stderr: "",
      });

    const result = await runUpdate({
      defaultBranch: "next",
      execFile,
    });

    expect(execFile).toHaveBeenCalledWith("npm", [
      "install",
      "-g",
      "@tingrudeng/worker-review-orchestrator-cli@next",
    ]);
    expect(result.performedCommand).toContain("@next");
  });

  it("throws on npm failure with a descriptive message", async () => {
    const execFile = vi.fn().mockRejectedValue(new Error("ENOTFOUND registry.npmjs.org"));

    await expect(runUpdate({ execFile })).rejects.toThrow(
      "Failed to update @tingrudeng/worker-review-orchestrator-cli",
    );
  });

  it("throws when the installed version cannot be verified after update", async () => {
    const execFile = vi.fn()
      .mockResolvedValueOnce({ stdout: "added 1 package", stderr: "" })
      .mockResolvedValueOnce({ stdout: "{\"dependencies\":{}}", stderr: "" });

    await expect(runUpdate({ execFile })).rejects.toThrow(
      "Failed to update @tingrudeng/worker-review-orchestrator-cli: updated package but could not verify the installed version",
    );
  });
});
