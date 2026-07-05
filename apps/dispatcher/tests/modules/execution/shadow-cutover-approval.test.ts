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

describe("shadow cutover approval", () => {
  it("generates a primary cutover approval file from archived successful drill evidence", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-shadow-cutover-approve-"));
    const evidencePath = path.join(stateDir, "shadow-cutover-drill.json");
    fs.writeFileSync(evidencePath, JSON.stringify({
      ok: true,
      phases: [
        { name: "drift_gate", ok: true, payload: { drift: { status: "matched" } } },
        { name: "reconciliation", ok: true, payload: { reconciliation: { reason: "not_needed" } } },
        { name: "cutover_preflight", ok: true, payload: { cutover: { reason: "cutover_ready" } } },
      ],
    }));

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
});
