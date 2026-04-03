import { describe, expect, it } from "vitest";

import { createDefaultTraeBetaConfig, normalizeTraeBetaConfig } from "../src/config.js";

describe("@tingrudeng/trae-beta-runtime config", () => {
  it("creates the new self-contained config shape without forgeflowRootDir", () => {
    const config = createDefaultTraeBetaConfig({
      projectPath: "/tmp/project",
      workerId: "trae-remote",
    }, {
      cwd: "/tmp/project",
    });

    expect(config.version).toBe(2);
    expect(config.projectPath).toBe("/tmp/project");
    expect("forgeflowRootDir" in config).toBe(false);
  });

  it("normalizes partial config into the new shape", () => {
    const config = normalizeTraeBetaConfig({
      version: 2,
      projectPath: "/tmp/project",
      dispatcherUrl: "http://127.0.0.1:8787",
      automationUrl: "http://127.0.0.1:8790",
      workerId: "trae-remote",
      traeBin: "/Applications/Trae CN.app",
      remoteDebuggingPort: 9222,
    }, {
      cwd: "/tmp/project",
    });

    expect(config.version).toBe(2);
    expect(config.projectPath).toBe("/tmp/project");
    expect(config.workerId).toBe("trae-remote");
    expect("forgeflowRootDir" in config).toBe(false);
  });
});
