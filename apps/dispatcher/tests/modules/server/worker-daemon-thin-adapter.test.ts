import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);
const workerDaemonSourcePath = path.join(repoRoot, "scripts/lib/worker-daemon.ts");
const workerDaemonHooksSourcePath = path.join(repoRoot, "scripts/lib/worker-daemon-hooks.ts");
const runWorkerDaemonSourcePath = path.join(repoRoot, "scripts/run-worker-daemon.ts");
const runWorkerAssignmentSourcePath = path.join(repoRoot, "scripts/run-worker-assignment.ts");
const runtimeBootstrapSourcePath = path.join(repoRoot, "scripts/lib/runtime-bootstrap.ts");

describe("worker daemon thin adapter", () => {
  it("keeps dispatcher client plumbing out of the script adapter", () => {
    const source = fs.readFileSync(workerDaemonSourcePath, "utf8");

    expect(source).not.toContain("function callWithRetry");
    expect(source).not.toContain("function callStateDirDispatcher");
    expect(source).not.toContain("function readStateDirResponseJson");
    expect(source).not.toContain("setInterval");
  });

  it("keeps local logger and metrics hooks in a dedicated adapter", () => {
    const workerDaemonSource = fs.readFileSync(workerDaemonSourcePath, "utf8");
    const hookSource = fs.readFileSync(workerDaemonHooksSourcePath, "utf8");

    expect(workerDaemonSource).not.toContain("recordTaskMetric");
    expect(workerDaemonSource).not.toContain("logTaskCompleted");
    expect(workerDaemonSource).not.toContain("logTaskFailed");
    expect(workerDaemonSource).toContain("./worker-daemon-hooks.js");
    expect(hookSource).toContain("buildManagedTaskCallbacks");
    expect(hookSource).toContain("buildFailedResultCallbacks");
  });

  it("keeps dist bootstrap logic inside the explicit runtime bootstrap adapter", () => {
    const workerDaemonSource = fs.readFileSync(workerDaemonSourcePath, "utf8");
    const runWorkerDaemonSource = fs.readFileSync(runWorkerDaemonSourcePath, "utf8");
    const runWorkerAssignmentSource = fs.readFileSync(runWorkerAssignmentSourcePath, "utf8");
    const runtimeBootstrapSource = fs.readFileSync(runtimeBootstrapSourcePath, "utf8");

    expect(workerDaemonSource).not.toContain("execSync");
    expect(workerDaemonSource).not.toContain("pathToFileURL");
    expect(workerDaemonSource).not.toContain("pnpm --filter @tingrudeng/beta-runtime-core build");
    expect(runWorkerDaemonSource).not.toContain("execSync");
    expect(runWorkerAssignmentSource).not.toContain("execSync");
    expect(runWorkerAssignmentSource).not.toContain("pathToFileURL");
    expect(runWorkerAssignmentSource).not.toContain("newestMtimeMs");
    expect(runtimeBootstrapSource).toContain("importWorkerDaemonRuntime");
    expect(runtimeBootstrapSource).toContain("importWorkerAssignmentRuntime");
    expect(runtimeBootstrapSource).toContain("importDispatcherWorkerRuntimeFactories");
    expect(runtimeBootstrapSource).toContain("ensureDispatcherRuntimeBridgeDist");
  });
});
