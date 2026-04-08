import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);
const scriptPath = path.join(repoRoot, "scripts/start-control-plane.sh");
const tempRoots: string[] = [];

function makeTempDir() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-start-control-plane-"));
  tempRoots.push(tempDir);
  return tempDir;
}

afterEach(() => {
  for (const tempDir of tempRoots.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("start-control-plane.sh", () => {
  it("defaults the dispatcher host to 127.0.0.1", () => {
    const tempDir = makeTempDir();
    const fakeBinDir = path.join(tempDir, "bin");
    const fakeNodeLog = path.join(tempDir, "node.log");
    fs.mkdirSync(fakeBinDir, { recursive: true });
    fs.writeFileSync(
      path.join(fakeBinDir, "node"),
      [
        "#!/usr/bin/env bash",
        "printf '%s\\n' \"$@\" > \"$FAKE_NODE_LOG\"",
      ].join("\n"),
    );
    fs.chmodSync(path.join(fakeBinDir, "node"), 0o755);

    const result = spawnSync("bash", [scriptPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
        FORGEFLOW_ROOT_DIR: repoRoot,
        FORGEFLOW_STATE_DIR: path.join(tempDir, "state"),
        FAKE_NODE_LOG: fakeNodeLog,
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("http://127.0.0.1:8787");
    expect(fs.readFileSync(fakeNodeLog, "utf8")).toContain("--host\n127.0.0.1\n");
  });
});
