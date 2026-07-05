import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);
const cutoverDrillScriptPath = path.join(repoRoot, "scripts/verify-shadow-cutover-drill.mjs");
const shadowReconcilerScriptPath = path.join(repoRoot, "scripts/run-shadow-reconciler.mjs");

describe("shadow cutover automation", () => {
  it("runs the production cutover drill as drift, reconcile, and strict preflight phases", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-shadow-cutover-drill-"));
    const result = spawnSync("node", [cutoverDrillScriptPath, stateDir], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 90_000,
      env: {
        ...process.env,
        DISPATCHER_SHADOW_MODE: "disabled",
        DISPATCHER_QUEUE_SHADOW_MODE: "disabled",
        DISPATCHER_POSTGRES_URL: "",
      },
    });

    expect(result.status).toBe(2);
    const payload = JSON.parse(result.stdout);
    expect(payload.ok).toBe(false);
    expect(payload.phases.map((phase: { name: string }) => phase.name)).toEqual([
      "drift_gate",
      "reconciliation",
      "cutover_preflight",
    ]);
    expect(payload.phases[1].payload.reconciliation).toEqual({
      requested: true,
      attempted: false,
      reason: "shadow_not_configured",
    });
    expect(payload.phases[2].payload.cutover.reason).toBe("shadow_not_configured");
  }, 90_000);

  it("writes production cutover drill evidence to an output file", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-shadow-cutover-drill-"));
    const outputPath = path.join(stateDir, "evidence", "cutover-drill.json");
    const result = spawnSync("node", [cutoverDrillScriptPath, stateDir, "--output", outputPath], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 90_000,
      env: {
        ...process.env,
        DISPATCHER_SHADOW_MODE: "disabled",
        DISPATCHER_QUEUE_SHADOW_MODE: "disabled",
        DISPATCHER_POSTGRES_URL: "",
      },
    });

    expect(result.status).toBe(2);
    const stdoutPayload = JSON.parse(result.stdout);
    const evidencePayload = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    expect(evidencePayload).toEqual(stdoutPayload);
    expect(evidencePayload.phases.map((phase: { name: string }) => phase.name)).toEqual([
      "drift_gate",
      "reconciliation",
      "cutover_preflight",
    ]);
  }, 90_000);

  it("runs the shadow reconciler once as an automation-friendly cadence entrypoint", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-shadow-reconciler-"));
    const result = spawnSync("node", [
      shadowReconcilerScriptPath,
      stateDir,
      "--once",
      "--interval-ms",
      "1000",
    ], {
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
    expect(payload).toMatchObject({
      ok: true,
      mode: "once",
      stateDir,
      intervalMs: 1000,
    });
    expect(payload.runs).toHaveLength(1);
    expect(payload.runs[0].payload.reconciliation).toEqual({
      requested: true,
      attempted: false,
      reason: "shadow_not_configured",
    });
  }, 30_000);

  it("writes a durable shadow reconciler status snapshot", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-shadow-reconciler-status-"));
    const outputPath = path.join(stateDir, "evidence", "shadow-reconciler-status.json");
    const result = spawnSync("node", [
      shadowReconcilerScriptPath,
      stateDir,
      "--once",
      "--interval-ms",
      "1000",
      "--output",
      outputPath,
    ], {
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
    const status = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    expect(status).toMatchObject({
      schemaVersion: "shadow-reconciler-status/v1",
      ok: true,
      mode: "once",
      stateDir,
      intervalMs: 1000,
      runCount: 1,
      failedRunCount: 0,
    });
    expect(status.lastRun.payload.reconciliation).toEqual({
      requested: true,
      attempted: false,
      reason: "shadow_not_configured",
    });
  }, 30_000);

  it("passes strict cutover requirements through the shadow reconciler", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-shadow-reconciler-strict-"));
    const result = spawnSync("node", [
      shadowReconcilerScriptPath,
      stateDir,
      "--once",
      "--interval-ms",
      "1000",
      "--require-configured",
      "--require-primary-backend",
      "--max-mismatches",
      "0",
      "--max-delta",
      "0",
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 30_000,
      env: {
        ...process.env,
        DISPATCHER_SHADOW_MODE: "disabled",
        DISPATCHER_QUEUE_SHADOW_MODE: "disabled",
        DISPATCHER_POSTGRES_URL: "",
        RUNTIME_STATE_BACKEND: "",
        DISPATCHER_PRIMARY_POSTGRES_URL: "",
      },
    });

    expect(result.status, result.stderr).toBe(2);
    const payload = JSON.parse(result.stdout);
    expect(payload.runs).toHaveLength(1);
    expect(payload.runs[0].payload.cutover).toMatchObject({
      required: true,
      ready: false,
      reason: "shadow_not_configured",
    });
    expect(payload.runs[0].payload.primaryBackend).toMatchObject({
      required: true,
      ready: false,
      reason: "primary_backend_not_selected",
    });
  }, 30_000);
});
