import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);
const checkShadowDriftScriptPath = path.join(repoRoot, "scripts/check-shadow-drift.mjs");
const dispatcherStateScriptPath = path.join(repoRoot, "scripts/lib/dispatcher-state.js");

function spawnConcurrentAlertWriter(stateDir: string, marker: string): Promise<void> {
  const source = `
    const [{ recordShadowDriftAlert }, stateModule] = await Promise.all([
      import(${JSON.stringify(pathToFileURL(checkShadowDriftScriptPath).href)}),
      import(${JSON.stringify(pathToFileURL(dispatcherStateScriptPath).href)}),
    ]);
    await recordShadowDriftAlert(
      stateModule,
      ${JSON.stringify(stateDir)},
      { level: "critical", mismatchCount: 1, absoluteDelta: 1, marker: ${JSON.stringify(marker)} },
      { status: "drifted", mismatches: [{ key: ${JSON.stringify(marker)}, delta: 1 }] },
    );
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "--eval", source], {
      cwd: repoRoot,
      env: {
        ...process.env,
        DISPATCHER_STATE_LOCK_TIMEOUT_MS: "10000",
        FORGEFLOW_DISPATCHER_DIST_PREBUILT: "1",
        RUNTIME_STATE_BACKEND: "json",
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`alert writer failed: code=${code} signal=${signal} stderr=${stderr}`));
    });
  });
}

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

  it("accepts reconciliation and alert threshold options", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-shadow-drift-"));
    const result = spawnSync("node", [
      checkShadowDriftScriptPath,
      stateDir,
      "--reconcile",
      "--max-mismatches",
      "2",
      "--max-delta",
      "4",
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
    expect(payload.alert).toMatchObject({
      level: "none",
      mismatchCount: 0,
      absoluteDelta: 0,
    });
    expect(payload.reconciliation).toEqual({
      requested: true,
      attempted: false,
      reason: "shadow_not_configured",
    });
  }, 30_000);

  it("supports environment-driven automatic reconciliation", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-shadow-drift-"));
    const result = spawnSync("node", [checkShadowDriftScriptPath, stateDir], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 30_000,
      env: {
        ...process.env,
        DISPATCHER_SHADOW_MODE: "disabled",
        DISPATCHER_QUEUE_SHADOW_MODE: "disabled",
        DISPATCHER_POSTGRES_URL: "",
        DISPATCHER_SHADOW_DRIFT_AUTO_RECONCILE: "1",
      },
    });

    expect(result.status, result.stderr).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.reconciliation).toEqual({
      requested: true,
      attempted: false,
      reason: "shadow_not_configured",
    });
  }, 30_000);

  it("fails cutover readiness when shadow is not configured", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-shadow-drift-"));
    const result = spawnSync("node", [checkShadowDriftScriptPath, stateDir, "--require-configured"], {
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

    expect(result.status).toBe(2);
    const payload = JSON.parse(result.stdout);
    expect(payload.ok).toBe(false);
    expect(payload.cutover).toEqual({
      required: true,
      ready: false,
      reason: "shadow_not_configured",
    });
  }, 30_000);

  it("accepts primary shadow mode when postgres primary backend is configured", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-shadow-drift-"));
    const result = spawnSync("node", [
      checkShadowDriftScriptPath,
      stateDir,
      "--require-configured",
      "--require-primary-backend",
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 30_000,
      env: {
        ...process.env,
        DISPATCHER_SHADOW_MODE: "primary",
        DISPATCHER_QUEUE_SHADOW_MODE: "primary",
        DISPATCHER_POSTGRES_URL: "",
        RUNTIME_STATE_BACKEND: "postgres",
        DISPATCHER_PRIMARY_POSTGRES_URL: "postgres://example.invalid/forgeflow",
      },
    });

    expect(result.status, result.stderr).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.drift.status).toBe("matched");
    expect(payload.primaryBackend.reason).toBe("primary_backend_configured");
    expect(payload.cutover).toEqual({
      required: true,
      ready: true,
      reason: "cutover_ready",
    });
  }, 30_000);

  it("fails primary shadow mode when postgres primary backend is not selected", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-shadow-drift-"));
    const result = spawnSync("node", [checkShadowDriftScriptPath, stateDir, "--require-configured"], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 30_000,
      env: {
        ...process.env,
        DISPATCHER_SHADOW_MODE: "primary",
        DISPATCHER_QUEUE_SHADOW_MODE: "primary",
        DISPATCHER_POSTGRES_URL: "",
        RUNTIME_STATE_BACKEND: "sqlite",
        DISPATCHER_PRIMARY_POSTGRES_URL: "",
      },
    });

    expect(result.status).toBe(2);
    const payload = JSON.parse(result.stdout);
    expect(payload.drift.status).toBe("primary_unsupported");
    expect(payload.cutover).toEqual({
      required: true,
      ready: false,
      reason: "primary_backend_not_selected",
    });
  }, 30_000);

  it("fails cutover readiness when postgres primary backend is not selected", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-shadow-drift-"));
    const result = spawnSync("node", [checkShadowDriftScriptPath, stateDir, "--require-primary-backend"], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 30_000,
      env: {
        ...process.env,
        DISPATCHER_SHADOW_MODE: "disabled",
        DISPATCHER_QUEUE_SHADOW_MODE: "disabled",
        DISPATCHER_POSTGRES_URL: "",
        RUNTIME_STATE_BACKEND: "sqlite",
        DISPATCHER_PRIMARY_POSTGRES_URL: "postgres://example.invalid/forgeflow",
      },
    });

    expect(result.status).toBe(2);
    const payload = JSON.parse(result.stdout);
    expect(payload.primaryBackend).toEqual({
      required: true,
      ready: false,
      reason: "primary_backend_not_selected",
    });
    expect(payload.cutover).toEqual({
      required: true,
      ready: false,
      reason: "primary_backend_not_selected",
    });
  }, 30_000);

  it("accepts cutover readiness when postgres primary backend env is configured", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-shadow-drift-"));
    const result = spawnSync("node", [checkShadowDriftScriptPath, stateDir, "--require-primary-backend"], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 30_000,
      env: {
        ...process.env,
        DISPATCHER_SHADOW_MODE: "disabled",
        DISPATCHER_QUEUE_SHADOW_MODE: "disabled",
        DISPATCHER_POSTGRES_URL: "",
        RUNTIME_STATE_BACKEND: "postgres",
        DISPATCHER_PRIMARY_POSTGRES_URL: "postgres://example.invalid/forgeflow",
      },
    });

    expect(result.status, result.stderr).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.primaryBackend).toEqual({
      required: true,
      ready: true,
      reason: "primary_backend_configured",
    });
    expect(payload.cutover).toEqual({
      required: true,
      ready: true,
      reason: "cutover_ready",
    });
  }, 30_000);

  it("rejects invalid environment threshold values", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-shadow-drift-"));
    const result = spawnSync("node", [checkShadowDriftScriptPath, stateDir], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 30_000,
      env: {
        ...process.env,
        DISPATCHER_SHADOW_MODE: "disabled",
        DISPATCHER_QUEUE_SHADOW_MODE: "disabled",
        DISPATCHER_POSTGRES_URL: "",
        DISPATCHER_SHADOW_DRIFT_MAX_MISMATCHES: "not-a-number",
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("DISPATCHER_SHADOW_DRIFT_MAX_MISMATCHES must be a non-negative number");
  }, 30_000);

  it("preserves concurrent cross-process alert writes under the runtime state lock", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-shadow-alert-lock-"));
    const markers = Array.from({ length: 8 }, (_, index) => `writer-${index + 1}`);

    try {
      await Promise.all(markers.map((marker) => spawnConcurrentAlertWriter(stateDir, marker)));
      const state = JSON.parse(
        fs.readFileSync(path.join(stateDir, "runtime-state.json"), "utf8"),
      );
      const recordedMarkers = state.events
        .filter((event: { type: string }) => event.type === "shadow_drift_detected")
        .map((event: { payload: { alert: { marker: string } } }) => event.payload.alert.marker)
        .sort();

      expect(recordedMarkers).toEqual([...markers].sort());
      expect(state.sequence).toBe(markers.length);
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  }, 30_000);

});
