import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readRuntimeStatePrimaryCutoverStatus } from "../../../src/modules/server/runtime-state-primary-cutover.js";

const tempRoots: string[] = [];
const originalBackend = process.env.RUNTIME_STATE_BACKEND;
const originalPrimaryUrl = process.env.DISPATCHER_PRIMARY_POSTGRES_URL;

function makeStateDir(): string {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-primary-cutover-"));
  tempRoots.push(stateDir);
  return stateDir;
}

function restoreEnv(): void {
  if (originalBackend === undefined) {
    delete process.env.RUNTIME_STATE_BACKEND;
  } else {
    process.env.RUNTIME_STATE_BACKEND = originalBackend;
  }
  if (originalPrimaryUrl === undefined) {
    delete process.env.DISPATCHER_PRIMARY_POSTGRES_URL;
  } else {
    process.env.DISPATCHER_PRIMARY_POSTGRES_URL = originalPrimaryUrl;
  }
}

function writeJson(filePath: string, payload: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeCutoverEvidence(stateDir: string): { approvalPath: string; evidencePath: string; evidenceSha256: string } {
  const evidencePath = path.join(stateDir, "shadow-cutover-drill.json");
  const approvalPath = path.join(stateDir, "shadow-cutover-approval.json");
  const evidenceContent = `${JSON.stringify({
    ok: true,
    phases: [{ name: "cutover_preflight", ok: true, payload: { cutover: { reason: "cutover_ready" } } }],
  })}\n`;
  const evidenceSha256 = crypto.createHash("sha256").update(evidenceContent).digest("hex");
  fs.writeFileSync(evidencePath, evidenceContent, "utf8");
  writeJson(approvalPath, {
    approved: true,
    approvedAt: "2026-07-06T01:00:00.000Z",
    evidencePath,
    evidenceSha256,
    cutoverReason: "cutover_ready",
  });
  writeJson(path.join(stateDir, "shadow-cutover-ready.json"), {
    ok: true,
    phases: [
      { name: "strict_cutover_preflight", ok: true, payload: { cutover: { reason: "cutover_ready" } } },
      {
        name: "approval_evidence",
        ok: true,
        payload: { ok: true, approvalPath, evidencePath, evidenceSha256, cutoverReason: "cutover_ready" },
      },
    ],
  });
  return { approvalPath, evidencePath, evidenceSha256 };
}

afterEach(() => {
  restoreEnv();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("runtime-state-primary-cutover", () => {
  it("reports ready when approval and final ready evidence match", () => {
    const stateDir = makeStateDir();
    process.env.RUNTIME_STATE_BACKEND = "postgres";
    process.env.DISPATCHER_PRIMARY_POSTGRES_URL = "postgres://localhost/forgeflow";
    const evidence = writeCutoverEvidence(stateDir);

    const status = readRuntimeStatePrimaryCutoverStatus(stateDir);

    expect(status.status).toBe("ready");
    expect(status.primaryBackend).toEqual({ selected: true, configured: true });
    expect(status.approval).toMatchObject({
      exists: true,
      path: evidence.approvalPath,
      evidencePath: evidence.evidencePath,
      evidenceSha256: evidence.evidenceSha256,
    });
    expect(status.ready).toMatchObject({ exists: true, ok: true });
    expect(status.revocation.exists).toBe(false);
    expect(status.lastError).toBeNull();
  });

  it("reports blocked when revocation marker exists", () => {
    const stateDir = makeStateDir();
    writeCutoverEvidence(stateDir);
    writeJson(path.join(stateDir, "shadow-cutover-revocation.json"), {
      revoked: true,
      revokedAt: "2026-07-06T02:00:00.000Z",
      reason: "operator_rollback",
    });

    const status = readRuntimeStatePrimaryCutoverStatus(stateDir);

    expect(status.status).toBe("blocked");
    expect(status.revocation).toMatchObject({
      exists: true,
      revokedAt: "2026-07-06T02:00:00.000Z",
      reason: "operator_rollback",
    });
  });

  it("reports failed when ready evidence no longer matches approval", () => {
    const stateDir = makeStateDir();
    writeCutoverEvidence(stateDir);
    const readyPath = path.join(stateDir, "shadow-cutover-ready.json");
    const ready = JSON.parse(fs.readFileSync(readyPath, "utf8"));
    ready.phases[1].payload.evidenceSha256 = "0".repeat(64);
    writeJson(readyPath, ready);

    const status = readRuntimeStatePrimaryCutoverStatus(stateDir);

    expect(status.status).toBe("failed");
    expect(status.lastError).toContain("evidenceSha256");
  });
});
