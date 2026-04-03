import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { runTraeBetaDoctor } from "../src/doctor.js";
import { writeTraeBetaConfig } from "../src/config.js";

function makeTempDir(prefix: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function createFakeTraeApp(rootDir: string) {
  const appBundle = path.join(rootDir, "Trae CN.app");
  const executable = path.join(appBundle, "Contents", "MacOS", "Electron");
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.writeFileSync(executable, "#!/bin/sh\nexit 0\n");
  fs.chmodSync(executable, 0o755);
  return appBundle;
}

describe("@tingrudeng/trae-beta-runtime doctor", () => {
  it("fails when projectPath is not a git worktree", () => {
    const rootDir = makeTempDir("trae-beta-doctor-nonrepo-");
    const projectPath = path.join(rootDir, "project");
    fs.mkdirSync(projectPath, { recursive: true });
    const traeBin = createFakeTraeApp(rootDir);

    const result = runTraeBetaDoctor({
      config: {
        projectPath,
        dispatcherUrl: "http://127.0.0.1:8787",
        automationUrl: "http://127.0.0.1:8790",
        workerId: "trae-remote",
        traeBin,
        remoteDebuggingPort: 9222,
      },
    });

    expect(result.ok).toBe(false);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "project-git-repo",
          ok: false,
        }),
      ]),
    );
  });

  it("passes the git repo check when projectPath is a git worktree", () => {
    const rootDir = makeTempDir("trae-beta-doctor-repo-");
    const projectPath = path.join(rootDir, "project");
    fs.mkdirSync(projectPath, { recursive: true });
    execFileSync("git", ["init"], {
      cwd: projectPath,
      stdio: "ignore",
    });
    const traeBin = createFakeTraeApp(rootDir);

    const result = runTraeBetaDoctor({
      config: {
        projectPath,
        dispatcherUrl: "http://127.0.0.1:8787",
        automationUrl: "http://127.0.0.1:8790",
        workerId: "trae-remote",
        traeBin,
        remoteDebuggingPort: 9222,
      },
    });

    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "pnpm",
          ok: true,
        }),
        expect.objectContaining({
          name: "project-git-repo",
          ok: true,
        }),
      ]),
    );
  });

  it("treats pnpm as optional for the self-contained runtime", () => {
    const rootDir = makeTempDir("trae-beta-doctor-optional-pnpm-");
    const projectPath = path.join(rootDir, "project");
    fs.mkdirSync(projectPath, { recursive: true });
    execFileSync("git", ["init"], {
      cwd: projectPath,
      stdio: "ignore",
    });
    const traeBin = createFakeTraeApp(rootDir);

    const result = runTraeBetaDoctor({
      config: {
        projectPath,
        dispatcherUrl: "http://127.0.0.1:8787",
        automationUrl: "http://127.0.0.1:8790",
        workerId: "trae-remote",
        traeBin,
        remoteDebuggingPort: 9222,
      },
    });

    const pnpmCheck = result.checks.find((check) => check.name === "pnpm");
    expect(pnpmCheck).toBeDefined();
    expect(pnpmCheck?.ok).toBe(true);
  });

  it("prefers explicit config over the persisted config file", () => {
    const rootDir = makeTempDir("trae-beta-doctor-config-override-");
    const persistedProjectPath = path.join(rootDir, "persisted-project");
    const explicitProjectPath = path.join(rootDir, "explicit-project");
    fs.mkdirSync(persistedProjectPath, { recursive: true });
    fs.mkdirSync(explicitProjectPath, { recursive: true });
    execFileSync("git", ["init"], {
      cwd: persistedProjectPath,
      stdio: "ignore",
    });
    const traeBin = createFakeTraeApp(rootDir);
    const configPath = path.join(rootDir, "config.json");

    writeTraeBetaConfig(
      {
        version: 2,
        projectPath: persistedProjectPath,
        dispatcherUrl: "http://127.0.0.1:8787",
        automationUrl: "http://127.0.0.1:8790",
        workerId: "trae-persisted",
        traeBin,
        remoteDebuggingPort: 9222,
      },
      { configPath },
    );

    const result = runTraeBetaDoctor({
      configPath,
      config: {
        projectPath: explicitProjectPath,
        workerId: "trae-explicit",
      },
    });

    expect(result.ok).toBe(false);
    expect(result.config.projectPath).toBe(explicitProjectPath);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "project-git-repo",
          ok: false,
        }),
      ]),
    );
  });
});
