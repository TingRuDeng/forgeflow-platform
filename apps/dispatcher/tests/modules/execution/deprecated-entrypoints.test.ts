import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);

const createdDirs: string[] = [];

async function loadDeprecatedEntryPointCheck(): Promise<{
  findDeprecatedEntryPoints: (options?: { cwd?: string }) => string[];
}> {
  return import(path.join(repoRoot, "scripts/check-deprecated-entrypoints.mjs"));
}

function makeTempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-deprecated-entrypoints-"));
  createdDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("deprecated entrypoint gate", () => {
  it("reports no deprecated entrypoints in an empty checkout", async () => {
    const { findDeprecatedEntryPoints } = await loadDeprecatedEntryPointCheck();

    expect(findDeprecatedEntryPoints({ cwd: makeTempRepo() })).toEqual([]);
  });

  it("reports deprecated entrypoints relative to the checked repository root", async () => {
    const { findDeprecatedEntryPoints } = await loadDeprecatedEntryPointCheck();
    const tempRepo = makeTempRepo();
    const deprecatedPath = path.join(tempRepo, "scripts/start-staging-dispatcher.sh");
    fs.mkdirSync(path.dirname(deprecatedPath), { recursive: true });
    fs.writeFileSync(deprecatedPath, "#!/usr/bin/env bash\n");

    expect(findDeprecatedEntryPoints({ cwd: tempRepo })).toEqual(["scripts/start-staging-dispatcher.sh"]);
  });
});
