import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);
const checkShadowDriftScriptPath = path.join(repoRoot, "scripts/check-shadow-drift.mjs");

describe("shadow drift verification", () => {
  it("reports not_configured when shadow Postgres is disabled", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-shadow-drift-"));
    fs.writeFileSync(path.join(stateDir, "runtime-state.db"), "old schema placeholder");
    const result = spawnSync("node", [checkShadowDriftScriptPath, stateDir], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 30_000,
      env: {
        ...process.env,
        DISPATCHER_SHADOW_MODE: "disabled",
        DISPATCHER_QUEUE_SHADOW_MODE: "disabled",
        DISPATCHER_POSTGRES_URL: "",
      },
    });

    expect(result.status, result.stderr).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.ok).toBe(true);
    expect(payload.drift.status).toBe("not_configured");
    expect(payload.drift.mismatches).toEqual([]);
  }, 30_000);
});
