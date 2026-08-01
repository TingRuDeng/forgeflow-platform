import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createDefaultCodexBetaConfig,
  inspectCodexBetaConfigPermissions,
  readCodexBetaConfig,
  writeCodexBetaConfig,
} from "../src/config.js";
import { runCodexBetaDoctor } from "../src/doctor.js";
import { initCodexBetaConfig } from "../src/init.js";

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
  return createDefaultCodexBetaConfig({
    repoDir: process.cwd(),
    codexBin: process.execPath,
  });
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("Codex beta config security", () => {
  it("creates owner-only config paths and round-trips config", () => {
    const { configPath } = makeConfigPath("codex-beta-config-create-");

    writeCodexBetaConfig(makeConfig(), { configPath });

    expect(readCodexBetaConfig({ configPath })?.codexBin).toBe(process.execPath);
    expect(fs.statSync(path.dirname(configPath)).mode & 0o777).toBe(0o700);
    expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
  });

  it("repairs a legacy file during init", () => {
    const { configPath } = makeConfigPath("codex-beta-config-repair-");
    fs.mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(configPath, `${JSON.stringify(makeConfig())}\n`, { mode: 0o644 });
    fs.chmodSync(configPath, 0o644);

    initCodexBetaConfig({ configPath });

    expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
    expect(readCodexBetaConfig({ configPath })?.codexBin).toBe(process.execPath);
  });

  it("rejects symbolic-link config files without overwriting their target", () => {
    const { root, configPath } = makeConfigPath("codex-beta-config-link-");
    fs.mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o700 });
    const targetPath = path.join(root, "target.json");
    fs.writeFileSync(targetPath, "target\n", { mode: 0o600 });
    fs.symlinkSync(targetPath, configPath);

    expect(() => writeCodexBetaConfig(makeConfig(), { configPath })).toThrow(/symbolic link/i);
    expect(fs.readFileSync(targetPath, "utf8")).toBe("target\n");
  });

  it("rejects custom config directories writable by group or others", () => {
    const { configPath } = makeConfigPath("codex-beta-config-writable-");
    fs.mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o777 });
    fs.chmodSync(path.dirname(configPath), 0o777);
    fs.writeFileSync(configPath, `${JSON.stringify(makeConfig())}\n`, { mode: 0o600 });

    expect(() => readCodexBetaConfig({ configPath })).toThrow(/directory.*writable/i);
  });

  it("reports insecure config permissions through doctor", () => {
    const { configPath } = makeConfigPath("codex-beta-config-doctor-");
    writeCodexBetaConfig(makeConfig(), { configPath });
    fs.chmodSync(configPath, 0o644);

    const result = runCodexBetaDoctor({ configPath, config: makeConfig() });

    expect(inspectCodexBetaConfigPermissions({ configPath }).ok).toBe(false);
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "config-permissions", ok: false }),
    ]));
  });
});
