import path from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);
const verifyLiveDispatcherDrScriptPath = path.join(repoRoot, "scripts/verify-live-dispatcher-dr.mjs");

describe("stage3 live dispatcher DR verification", () => {
  it("validates backup and restore while a live dispatcher handles writes", () => {
    const result = spawnSync("node", [verifyLiveDispatcherDrScriptPath], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 30_000,
    });

    expect(result.status, result.stderr).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.ok).toBe(true);
    expect(payload.backupDuringServerOpen).toBe(true);
    expect(payload.liveWriteSuccessCount).toBe(payload.liveWriteAttemptCount);
    expect(payload.copiedFiles).toContain("runtime-state.db-wal");
    expect(payload.restoredFiles).toContain("runtime-state.db-wal");
    expect(payload.integrityCheck).toBe("ok");
    expect(payload.snapshotCount).toBeGreaterThan(1);
    expect(payload.restoredTaskCount).toBeGreaterThan(0);
    expect(payload.restoredEventCount).toBeGreaterThan(0);
  }, 30_000);
});
