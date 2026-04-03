import { afterEach, describe, expect, it, vi } from "vitest";

import { updateLocalCheckout } from "../src/update.js";

describe("@tingrudeng/trae-beta-runtime update", () => {
  const previousVersion = process.env.npm_package_version;

  afterEach(() => {
    if (previousVersion === undefined) {
      delete process.env.npm_package_version;
    } else {
      process.env.npm_package_version = previousVersion;
    }
  });

  it("runs a global npm install to update the package and reports the verified version", async () => {
    process.env.npm_package_version = "0.1.0-beta.3";
    const execFile = vi.fn(async (_cmd: string, args: string[]) => {
      if (args[0] === "install") {
        return { stdout: "changed 1 package in 2s", stderr: "" };
      }
      if (args[0] === "list") {
        return {
          stdout: JSON.stringify({
            dependencies: {
              "@tingrudeng/trae-beta-runtime": { version: "0.1.0-beta.5" },
            },
          }),
          stderr: "",
        };
      }
      return { stdout: "", stderr: "" };
    });

    const result = await updateLocalCheckout({ execFile });

    expect(result).toEqual({
      packageName: "@tingrudeng/trae-beta-runtime",
      previousVersion: "0.1.0-beta.3",
      installedVersion: "0.1.0-beta.5",
      performedCommand: "npm install -g @tingrudeng/trae-beta-runtime@latest",
      stdout: "changed 1 package in 2s",
      stderr: "",
      message: "Updated the global ForgeFlow Trae beta runtime package. Restart long-running gateway/worker processes to use the new version.",
    });
    expect(execFile).toHaveBeenCalledWith("npm", [
      "install",
      "-g",
      "@tingrudeng/trae-beta-runtime@latest",
    ]);
    expect(execFile).toHaveBeenCalledWith("npm", [
      "list",
      "-g",
      "@tingrudeng/trae-beta-runtime",
      "--json",
      "--depth=0",
    ]);
  });

  it("supports updating to an explicit dist-tag", async () => {
    const execFile = vi.fn(async (_cmd: string, args: string[]) => {
      if (args[0] === "install") {
        return { stdout: "", stderr: "" };
      }
      if (args[0] === "list") {
        return {
          stdout: JSON.stringify({
            dependencies: {
              "@tingrudeng/trae-beta-runtime": { version: "0.2.0-beta.1" },
            },
          }),
          stderr: "",
        };
      }
      return { stdout: "", stderr: "" };
    });

    await updateLocalCheckout({
      defaultBranch: "beta",
      execFile,
    });

    expect(execFile).toHaveBeenCalledWith("npm", [
      "install",
      "-g",
      "@tingrudeng/trae-beta-runtime@beta",
    ]);
  });

  it("supports an explicit installed version override for previous-version reporting", async () => {
    delete process.env.npm_package_version;
    const execFile = vi.fn(async (_cmd: string, args: string[]) => {
      if (args[0] === "install") {
        return { stdout: "", stderr: "" };
      }
      if (args[0] === "list") {
        return {
          stdout: JSON.stringify({
            dependencies: {
              "@tingrudeng/trae-beta-runtime": { version: "0.1.0-beta.14" },
            },
          }),
          stderr: "",
        };
      }
      return { stdout: "", stderr: "" };
    });

    const result = await updateLocalCheckout({
      installedVersion: "0.1.0-beta.13",
      execFile,
    });

    expect(result.previousVersion).toBe("0.1.0-beta.13");
    expect(result.installedVersion).toBe("0.1.0-beta.14");
  });

  it("surfaces npm update failures", async () => {
    const execFile = vi.fn(async () => {
      throw new Error("spawn EACCES");
    });

    await expect(updateLocalCheckout({ execFile })).rejects.toThrow(
      "Failed to update @tingrudeng/trae-beta-runtime: spawn EACCES",
    );
  });

  it("fails when npm list cannot verify the installed version after update", async () => {
    process.env.npm_package_version = "0.1.0-beta.3";
    const execFile = vi.fn(async (_cmd: string, args: string[]) => {
      if (args[0] === "install") {
        return { stdout: "updated", stderr: "" };
      }
      if (args[0] === "list") {
        throw new Error("npm list failed");
      }
      return { stdout: "", stderr: "" };
    });

    await expect(updateLocalCheckout({ execFile })).rejects.toThrow(
      "Failed to update @tingrudeng/trae-beta-runtime: npm list failed",
    );
  });

  it("fails when npm list returns no installed version", async () => {
    const execFile = vi.fn(async (_cmd: string, args: string[]) => {
      if (args[0] === "install") {
        return { stdout: "updated", stderr: "" };
      }
      if (args[0] === "list") {
        return {
          stdout: JSON.stringify({ dependencies: {} }),
          stderr: "",
        };
      }
      return { stdout: "", stderr: "" };
    });

    await expect(updateLocalCheckout({ execFile })).rejects.toThrow(
      "Failed to update @tingrudeng/trae-beta-runtime: updated package but could not verify the installed version via npm list -g @tingrudeng/trae-beta-runtime --json --depth=0",
    );
  });
});
