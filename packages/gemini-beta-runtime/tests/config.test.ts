import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createDefaultGeminiBetaConfig,
  inspectGeminiBetaConfigPermissions,
  readGeminiBetaConfig,
  writeGeminiBetaConfig,
} from "../src/config.js";
import { runGeminiBetaDoctor } from "../src/doctor.js";
import { initGeminiBetaConfig } from "../src/init.js";

const tempRoots: string[] = [];

function makeConfigPath(prefix: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return {
    root,
    configPath: path.join(root, "config", "config.json"),
  };
}

function makeConfig() {
  return createDefaultGeminiBetaConfig({
    repoDir: process.cwd(),
    geminiBin: process.execPath,
  });
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("Gemini beta config security", () => {
  it("creates owner-only config paths and round-trips config", () => {
    const { configPath } = makeConfigPath("gemini-beta-config-create-");

    writeGeminiBetaConfig(makeConfig(), { configPath });

    expect(readGeminiBetaConfig({ configPath })?.geminiBin).toBe(process.execPath);
    expect(fs.statSync(path.dirname(configPath)).mode & 0o777).toBe(0o700);
    expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
  });

  it("repairs a legacy file during init", () => {
    const { configPath } = makeConfigPath("gemini-beta-config-repair-");
    fs.mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(configPath, `${JSON.stringify(makeConfig())}\n`, { mode: 0o644 });
    fs.chmodSync(configPath, 0o644);

    initGeminiBetaConfig({ configPath });

    expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
    expect(readGeminiBetaConfig({ configPath })?.geminiBin).toBe(process.execPath);
  });

  it("rejects symbolic-link config files without overwriting their target", () => {
    const { root, configPath } = makeConfigPath("gemini-beta-config-link-");
    fs.mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o700 });
    const targetPath = path.join(root, "target.json");
    fs.writeFileSync(targetPath, "target\n", { mode: 0o600 });
    fs.symlinkSync(targetPath, configPath);

    expect(() => writeGeminiBetaConfig(makeConfig(), { configPath })).toThrow(/symbolic link/i);
    expect(fs.readFileSync(targetPath, "utf8")).toBe("target\n");
  });

  it("rejects custom config directories writable by group or others", () => {
    const { configPath } = makeConfigPath("gemini-beta-config-writable-");
    fs.mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o777 });
    fs.chmodSync(path.dirname(configPath), 0o777);
    fs.writeFileSync(configPath, `${JSON.stringify(makeConfig())}\n`, { mode: 0o600 });

    expect(() => readGeminiBetaConfig({ configPath })).toThrow(/directory.*writable/i);
  });

  it("reports insecure config permissions through doctor", () => {
    const { configPath } = makeConfigPath("gemini-beta-config-doctor-");
    writeGeminiBetaConfig(makeConfig(), { configPath });
    fs.chmodSync(configPath, 0o644);

    const result = runGeminiBetaDoctor({ configPath, config: makeConfig() });

    expect(inspectGeminiBetaConfigPermissions({ configPath }).ok).toBe(false);
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "config-permissions", ok: false }),
    ]));
  });
});
