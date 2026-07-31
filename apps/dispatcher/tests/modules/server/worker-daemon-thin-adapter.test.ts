import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);
const workerDaemonSourcePath = path.join(repoRoot, "scripts/lib/worker-daemon.ts");
const workerDaemonHooksSourcePath = path.join(repoRoot, "scripts/lib/worker-daemon-hooks.ts");
const workerDaemonClientSourcePath = path.join(repoRoot, "scripts/lib/worker-daemon-dispatcher-client.ts");
const workerDaemonTaskExecutorSourcePath = path.join(repoRoot, "scripts/lib/worker-daemon-task-executor.ts");
const runWorkerDaemonSourcePath = path.join(repoRoot, "scripts/run-worker-daemon.ts");
const runWorkerAssignmentSourcePath = path.join(repoRoot, "scripts/run-worker-assignment.ts");
const runTraeAutomationWorkerSourcePath = path.join(repoRoot, "scripts/run-trae-automation-worker.ts");
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
    const taskExecutorSource = fs.readFileSync(workerDaemonTaskExecutorSourcePath, "utf8");

    expect(workerDaemonSource).not.toContain("recordTaskMetric");
    expect(workerDaemonSource).not.toContain("logTaskCompleted");
    expect(workerDaemonSource).not.toContain("logTaskFailed");
    expect(taskExecutorSource).toContain("./worker-daemon-hooks.js");
    expect(hookSource).toContain("buildManagedTaskCallbacks");
    expect(hookSource).toContain("buildFailedResultCallbacks");
  });

  it("keeps submit-result retry policy in beta-runtime-core", () => {
    const taskExecutorSource = fs.readFileSync(workerDaemonTaskExecutorSourcePath, "utf8");
    const runtimeWorkerDaemonSource = fs.readFileSync(path.join(repoRoot, "packages/beta-runtime-core/src/runtime/worker-daemon.ts"), "utf8");
    const managedTaskSource = fs.readFileSync(path.join(repoRoot, "packages/beta-runtime-core/src/runtime/managed-task-processor.ts"), "utf8");

    expect(taskExecutorSource).not.toContain("const SUBMIT_RESULT_MAX_RETRIES");
    expect(taskExecutorSource).not.toContain("const SUBMIT_RESULT_RETRY_DELAY_MS");
    expect(taskExecutorSource).not.toContain("getSubmitResultMaxRetries");
    expect(taskExecutorSource).not.toContain("getSubmitResultRetryDelayMs");
    expect(taskExecutorSource).toContain("resolveManagedWorkerTaskRetryPolicy");
    expect(runtimeWorkerDaemonSource).toContain("resolveManagedWorkerTaskRetryPolicy");
    expect(managedTaskSource).toContain("DEFAULT_SUBMIT_RESULT_MAX_RETRIES");
    expect(managedTaskSource).toContain("DEFAULT_SUBMIT_RESULT_RETRY_DELAY_MS");
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

  it("bootstraps beta-runtime-core before loading the Trae worker adapter", () => {
    const runTraeAutomationWorkerSource = fs.readFileSync(runTraeAutomationWorkerSourcePath, "utf8");
    const runtimeBootstrapSource = fs.readFileSync(runtimeBootstrapSourcePath, "utf8");

    expect(runtimeBootstrapSource).toContain("ensureTaskWorktreeRuntimeDist");
    expect(runTraeAutomationWorkerSource).toContain("ensureTaskWorktreeRuntimeDist");
    expect(runTraeAutomationWorkerSource).toContain('await import("./lib/trae-automation-worker.js")');
    expect(runTraeAutomationWorkerSource).not.toContain('from "./lib/trae-automation-worker.js"');
  });

  it("keeps worker-daemon as a thin cycle adapter under the file size budget", () => {
    const workerDaemonSource = fs.readFileSync(workerDaemonSourcePath, "utf8");
    const taskExecutorSource = fs.readFileSync(workerDaemonTaskExecutorSourcePath, "utf8");
    const clientSourceExists = fs.existsSync(workerDaemonClientSourcePath);
    const taskExecutorSourceExists = fs.existsSync(workerDaemonTaskExecutorSourcePath);

    expect(workerDaemonSource.split(/\r?\n/).length).toBeLessThanOrEqual(300);
    expect(workerDaemonSource).toContain("./worker-daemon-dispatcher-client.js");
    expect(workerDaemonSource).toContain("./worker-daemon-task-executor.js");
    expect(workerDaemonSource).not.toContain("function createLazyDispatcherClient");
    expect(workerDaemonSource).not.toContain("executeManagedWorkerTask");
    expect(taskExecutorSource).toContain("heartbeatManagedExternally: true");
    expect(clientSourceExists).toBe(true);
    expect(taskExecutorSourceExists).toBe(true);
  });
});
