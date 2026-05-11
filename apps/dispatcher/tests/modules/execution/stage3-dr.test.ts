import path from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);
const verifyStage3DrScriptPath = path.join(repoRoot, "scripts/verify-stage3-dr.mjs");

describe("stage3 DR verification", () => {
  it("validates a real sqlite runtime-state backup and restore", () => {
    const result = spawnSync("node", [verifyStage3DrScriptPath], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.ok).toBe(true);
    expect(payload.integrityCheck).toBe("ok");
    expect(payload.snapshotCount).toBe(1);
    expect(payload.restoredState.version).toBe(1);
  });
});
