import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);
const workerDaemonSourcePath = path.join(repoRoot, "scripts/lib/worker-daemon.ts");

describe("worker daemon thin adapter", () => {
  it("keeps dispatcher client plumbing out of the script adapter", () => {
    const source = fs.readFileSync(workerDaemonSourcePath, "utf8");

    expect(source).not.toContain("function callWithRetry");
    expect(source).not.toContain("function callStateDirDispatcher");
    expect(source).not.toContain("function readStateDirResponseJson");
    expect(source).not.toContain("setInterval");
  });
});
