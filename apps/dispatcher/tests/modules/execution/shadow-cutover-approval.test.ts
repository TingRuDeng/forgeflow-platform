import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);
const approveCutoverScriptPath = path.join(repoRoot, "scripts/approve-shadow-cutover.mjs");
const revokeCutoverScriptPath = path.join(repoRoot, "scripts/revoke-shadow-cutover.mjs");
const verifyCutoverApprovalScriptPath = path.join(repoRoot, "scripts/verify-shadow-cutover-approval.mjs");
const verifyCutoverReadyScriptPath = path.join(repoRoot, "scripts/verify-shadow-cutover-ready.mjs");

function writeSuccessfulDrillEvidence(stateDir: string): string {
  const evidencePath = path.join(stateDir, "shadow-cutover-drill.json");
  fs.writeFileSync(evidencePath, JSON.stringify({
    ok: true,
    phases: [
      { name: "drift_gate", ok: true, payload: { drift: { status: "matched" } } },
      { name: "reconciliation", ok: true, payload: { reconciliation: { reason: "not_needed" } } },
      { name: "cutover_preflight", ok: true, payload: { cutover: { reason: "cutover_ready" } } },
    ],
  }));
  return evidencePath;
}

describe("shadow cutover approval", () => {
  it("generates a primary cutover approval file from archived successful drill evidence", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-shadow-cutover-approve-"));
    const evidencePath = writeSuccessfulDrillEvidence(stateDir);

    const result = spawnSync("node", [approveCutoverScriptPath, stateDir, "--evidence", evidencePath], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 30_000,
    });

    expect(result.status, result.stderr).toBe(0);
    const payload = JSON.parse(result.stdout);
    const approvalPath = path.join(stateDir, "shadow-cutover-approval.json");
    expect(payload.approvalPath).toBe(approvalPath);
    const approval = JSON.parse(fs.readFileSync(approvalPath, "utf8"));
    expect(approval).toMatchObject({
      approved: true,
      evidencePath,
      cutoverReason: "cutover_ready",
    });
    expect(approval.evidenceSha256).toMatch(/^[a-f0-9]{64}$/);
  }, 30_000);

  it("verifies an approval marker and archived evidence before primary cutover", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-shadow-cutover-verify-"));
    const evidencePath = writeSuccessfulDrillEvidence(stateDir);
    const approvalResult = spawnSync("node", [approveCutoverScriptPath, stateDir, "--evidence", evidencePath], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(approvalResult.status, approvalResult.stderr).toBe(0);

    const verifyResult = spawnSync("node", [verifyCutoverApprovalScriptPath, stateDir], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 30_000,
    });

    expect(verifyResult.status, verifyResult.stderr).toBe(0);
    expect(JSON.parse(verifyResult.stdout)).toMatchObject({
      ok: true,
      approvalPath: path.join(stateDir, "shadow-cutover-approval.json"),
      evidencePath,
      cutoverReason: "cutover_ready",
    });
  }, 30_000);

  it("rejects approval verification when archived evidence has changed", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-shadow-cutover-verify-"));
    const evidencePath = writeSuccessfulDrillEvidence(stateDir);
    const approvalResult = spawnSync("node", [approveCutoverScriptPath, stateDir, "--evidence", evidencePath], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(approvalResult.status, approvalResult.stderr).toBe(0);
    fs.writeFileSync(evidencePath, "{\"ok\":false}\n");

    const verifyResult = spawnSync("node", [verifyCutoverApprovalScriptPath, stateDir], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 30_000,
    });

    expect(verifyResult.status).toBe(2);
    expect(verifyResult.stderr).toContain("evidenceSha256 mismatch");
  }, 30_000);

  it("rejects approval verification when cutover has been revoked", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-shadow-cutover-verify-"));
    const evidencePath = writeSuccessfulDrillEvidence(stateDir);
    const approvalResult = spawnSync("node", [approveCutoverScriptPath, stateDir, "--evidence", evidencePath], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(approvalResult.status, approvalResult.stderr).toBe(0);
    fs.writeFileSync(path.join(stateDir, "shadow-cutover-revocation.json"), JSON.stringify({
      revoked: true,
      reason: "operator_rollback",
    }));

    const verifyResult = spawnSync("node", [verifyCutoverApprovalScriptPath, stateDir], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 30_000,
    });

    expect(verifyResult.status).toBe(2);
    expect(verifyResult.stderr).toContain("cutover approval has been revoked");
  }, 30_000);

  it("runs final cutover readiness as strict preflight plus approval verification", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-shadow-cutover-ready-"));
    const evidencePath = writeSuccessfulDrillEvidence(stateDir);
    const approvalResult = spawnSync("node", [approveCutoverScriptPath, stateDir, "--evidence", evidencePath], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(approvalResult.status, approvalResult.stderr).toBe(0);

    const readyResult = spawnSync("node", [verifyCutoverReadyScriptPath, stateDir], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 90_000,
      env: {
        ...process.env,
        DISPATCHER_SHADOW_MODE: "disabled",
        DISPATCHER_QUEUE_SHADOW_MODE: "disabled",
        DISPATCHER_POSTGRES_URL: "",
        RUNTIME_STATE_BACKEND: "postgres",
        DISPATCHER_PRIMARY_POSTGRES_URL: "postgres://example.invalid/forgeflow",
      },
    });

    expect(readyResult.status).toBe(2);
    const payload = JSON.parse(readyResult.stdout);
    expect(payload.ok).toBe(false);
    expect(payload.phases.map((phase: { name: string }) => phase.name)).toEqual([
      "strict_cutover_preflight",
      "approval_evidence",
    ]);
    expect(payload.phases[0].payload.cutover.reason).toBe("shadow_not_configured");
    expect(payload.phases[1].ok).toBe(true);
  }, 90_000);

  it("writes final cutover readiness evidence to an output file", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-shadow-cutover-ready-evidence-"));
    const evidencePath = writeSuccessfulDrillEvidence(stateDir);
    const readyEvidencePath = path.join(stateDir, "evidence", "shadow-cutover-ready.json");
    const approvalResult = spawnSync("node", [approveCutoverScriptPath, stateDir, "--evidence", evidencePath], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(approvalResult.status, approvalResult.stderr).toBe(0);

    const readyResult = spawnSync("node", [verifyCutoverReadyScriptPath, stateDir, "--output", readyEvidencePath], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 90_000,
      env: {
        ...process.env,
        DISPATCHER_SHADOW_MODE: "disabled",
        DISPATCHER_QUEUE_SHADOW_MODE: "disabled",
        DISPATCHER_POSTGRES_URL: "",
        RUNTIME_STATE_BACKEND: "postgres",
        DISPATCHER_PRIMARY_POSTGRES_URL: "postgres://example.invalid/forgeflow",
      },
    });

    expect(readyResult.status).toBe(2);
    const stdoutPayload = JSON.parse(readyResult.stdout);
    const filePayload = JSON.parse(fs.readFileSync(readyEvidencePath, "utf8"));
    expect(filePayload).toEqual(stdoutPayload);
    expect(filePayload.phases.map((phase: { name: string }) => phase.name)).toEqual([
      "strict_cutover_preflight",
      "approval_evidence",
    ]);
    expect(filePayload.phases[1].ok).toBe(true);
  }, 90_000);

  it("rejects cutover approval when drill evidence is not successful", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-shadow-cutover-approve-"));
    const evidencePath = path.join(stateDir, "shadow-cutover-drill.json");
    fs.writeFileSync(evidencePath, JSON.stringify({
      ok: false,
      phases: [
        { name: "cutover_preflight", ok: false, payload: { cutover: { reason: "shadow_not_configured" } } },
      ],
    }));

    const result = spawnSync("node", [approveCutoverScriptPath, stateDir, "--evidence", evidencePath], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 30_000,
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("cutover drill evidence is not approved");
    expect(fs.existsSync(path.join(stateDir, "shadow-cutover-approval.json"))).toBe(false);
  }, 30_000);

  it("revokes cutover approval and archives rollback evidence", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-shadow-cutover-revoke-"));
    const approvalPath = path.join(stateDir, "shadow-cutover-approval.json");
    fs.writeFileSync(approvalPath, JSON.stringify({
      approved: true,
      approvedAt: "2026-07-05T10:00:00.000Z",
      evidenceSha256: "a".repeat(64),
      cutoverReason: "cutover_ready",
    }));

    const result = spawnSync("node", [revokeCutoverScriptPath, stateDir, "--reason", "operator_rollback"], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 30_000,
    });

    expect(result.status, result.stderr).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload).toMatchObject({
      revoked: true,
      reason: "operator_rollback",
      approvalPath,
      originalEvidenceSha256: "a".repeat(64),
    });
    expect(payload.approvalSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(payload.approvalArchivedPath).toContain("shadow-cutover-approval.revoked-");
    expect(fs.existsSync(approvalPath)).toBe(false);
    expect(fs.existsSync(payload.approvalArchivedPath)).toBe(true);
    const revocationPath = path.join(stateDir, "shadow-cutover-revocation.json");
    expect(JSON.parse(fs.readFileSync(revocationPath, "utf8"))).toEqual(payload);
  }, 30_000);

  it("rejects cutover revocation when no approval marker exists", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-shadow-cutover-revoke-"));
    const result = spawnSync("node", [revokeCutoverScriptPath, stateDir], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 30_000,
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("shadow-cutover-approval.json is required before revocation");
    expect(fs.existsSync(path.join(stateDir, "shadow-cutover-revocation.json"))).toBe(false);
  }, 30_000);
});
