import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runDoctor } from "../src/doctor.ts";
import type { DispatcherRuntimeConfig } from "../src/config.ts";

const tmpRoots: string[] = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-dispatcher-doctor-"));
  tmpRoots.push(dir);
  return dir;
}

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("dispatcher runtime doctor", () => {
  it("flags missing token when auth mode is token", async () => {
    const stateDir = makeTempDir();
    const config: DispatcherRuntimeConfig = {
      host: "127.0.0.1",
      port: 8787,
      stateDir,
      persistenceBackend: "sqlite",
      authMode: "token",
    };

    const result = await runDoctor(config);
    expect(result.ok).toBe(false);
    expect(result.problems.some((problem) => problem.includes("no apiToken"))).toBe(true);
  });
});
