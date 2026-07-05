import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const workerSourcePath = path.resolve("src/runtime/worker.ts");
const lifecycleSourcePath = path.resolve("src/runtime/submit-result-lifecycle.ts");

describe("Trae worker submitResult boundary", () => {
  it("keeps dispatcher submitResult lifecycle in a single helper", () => {
    const source = fs.readFileSync(workerSourcePath, "utf8");
    const lifecycleSource = fs.readFileSync(lifecycleSourcePath, "utf8");

    expect(source).not.toContain('emitPhaseEvent("submit_result_start"');
    expect(source).not.toContain('emitPhaseEvent("submit_result_done"');
    expect(source).toContain("submitResultLifecycle");
    expect(lifecycleSource.match(/await input\.submitResult/g)?.length).toBe(1);
    expect(lifecycleSource).toContain('input.emitPhaseEvent("submit_result_start"');
    expect(lifecycleSource).toContain('input.emitPhaseEvent("submit_result_done"');
    expect(lifecycleSource).toContain("input.promoteToIdle()");
    expect(lifecycleSource).toContain("input.releaseSession(input.sessionId)");
  });
});
