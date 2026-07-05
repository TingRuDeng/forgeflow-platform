import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { handleDispatcherHttpRequest } from "../../../src/modules/server/dispatcher-server.js";

const tempRoots: string[] = [];

function makeStateDir(): string {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-dr-status-"));
  tempRoots.push(stateDir);
  return stateDir;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("dispatcher server dr status", () => {
  it("exposes primary cutover evidence status", async () => {
    const response = await handleDispatcherHttpRequest({
      stateDir: makeStateDir(),
      method: "GET",
      pathname: "/api/dr/status",
      internalCall: true,
    });
    const payload = response.json as { primaryCutover?: unknown };

    expect(response.status).toBe(200);
    expect(payload).toHaveProperty("primaryCutover");
    expect(payload.primaryCutover).toMatchObject({
      status: "unknown",
      approval: { exists: false },
      ready: { exists: false },
      complete: { exists: false },
      revocation: { exists: false },
    });
  });
});
