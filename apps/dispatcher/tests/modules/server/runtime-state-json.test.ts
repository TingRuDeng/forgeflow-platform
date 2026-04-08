import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadRuntimeState } from "../../../src/modules/server/runtime-state-json.js";

const tempRoots: string[] = [];

function makeTempDir(): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-json-state-"));
  tempRoots.push(tempDir);
  return tempDir;
}

afterEach(() => {
  for (const tempDir of tempRoots.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("runtime-state-json", () => {
  it("throws a descriptive error when runtime-state.json is malformed", () => {
    const stateDir = makeTempDir();
    fs.writeFileSync(path.join(stateDir, "runtime-state.json"), "{not-json");

    expect(() => loadRuntimeState(stateDir)).toThrow(/failed to parse runtime-state\.json/i);
  });
});
