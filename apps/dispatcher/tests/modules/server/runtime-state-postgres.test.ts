import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const client = {
    end: vi.fn(async () => {}),
  };
  return {
    client,
    createPgClient: vi.fn(async () => client),
    loadPrimaryRuntimeStateSnapshot: vi.fn(async () => ({
      version: 1,
      sequence: 7,
      updatedAt: "2026-07-05T10:00:00.000Z",
      tasks: [{ id: "task-1", title: "Task 1", status: "ready" }],
    })),
    listRuntimeAuditEvents: vi.fn(async () => ({
      events: [],
      total: 0,
      limit: 500,
      hasMore: false,
      nextBeforeSequence: null,
    })),
    savePrimaryRuntimeStateSnapshot: vi.fn(async () => {}),
  };
});

vi.mock("@forgeflow/dispatcher-store-postgres", () => ({
  createPgClient: mocks.createPgClient,
  listRuntimeAuditEvents: mocks.listRuntimeAuditEvents,
  loadPrimaryRuntimeStateSnapshot: mocks.loadPrimaryRuntimeStateSnapshot,
  savePrimaryRuntimeStateSnapshot: mocks.savePrimaryRuntimeStateSnapshot,
}));

const originalBackend = process.env.RUNTIME_STATE_BACKEND;
const originalPrimaryUrl = process.env.DISPATCHER_PRIMARY_POSTGRES_URL;
const originalApprovalFile = process.env.DISPATCHER_PRIMARY_CUTOVER_APPROVAL_FILE;
const originalReadyFile = process.env.DISPATCHER_PRIMARY_CUTOVER_READY_FILE;

async function loadRuntimeStateModule() {
  return import("../../../src/modules/server/runtime-state.js");
}

function restoreEnv() {
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
  if (originalApprovalFile === undefined) {
    delete process.env.DISPATCHER_PRIMARY_CUTOVER_APPROVAL_FILE;
  } else {
    process.env.DISPATCHER_PRIMARY_CUTOVER_APPROVAL_FILE = originalApprovalFile;
  }
  if (originalReadyFile === undefined) {
    delete process.env.DISPATCHER_PRIMARY_CUTOVER_READY_FILE;
  } else {
    process.env.DISPATCHER_PRIMARY_CUTOVER_READY_FILE = originalReadyFile;
  }
}

function makeStateDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-postgres-state-"));
}

function writeCutoverReadyEvidence(input: {
  stateDir: string;
  approvalPath: string;
  evidencePath: string;
  evidenceSha256: string;
}): void {
  fs.writeFileSync(path.join(input.stateDir, "shadow-cutover-ready.json"), `${JSON.stringify({
    ok: true,
    stateDir: input.stateDir,
    phases: [
      {
        name: "strict_cutover_preflight",
        ok: true,
        payload: { cutover: { reason: "cutover_ready" } },
      },
      {
        name: "approval_evidence",
        ok: true,
        payload: {
          ok: true,
          approvalPath: input.approvalPath,
          evidencePath: input.evidencePath,
          evidenceSha256: input.evidenceSha256,
          cutoverReason: "cutover_ready",
        },
      },
    ],
  })}\n`);
}

function writeCutoverApproval(stateDir: string, options: { writeReady?: boolean } = {}): void {
  fs.mkdirSync(stateDir, { recursive: true });
  const evidencePath = path.join(stateDir, "shadow-cutover-drill.json");
  const evidenceContent = `${JSON.stringify({
    ok: true,
    phases: [
      { name: "cutover_preflight", ok: true, payload: { cutover: { reason: "cutover_ready" } } },
    ],
  })}\n`;
  const approvalPath = path.join(stateDir, "shadow-cutover-approval.json");
  const evidenceSha256 = crypto.createHash("sha256").update(evidenceContent).digest("hex");
  fs.writeFileSync(evidencePath, evidenceContent);
  fs.writeFileSync(approvalPath, JSON.stringify({
    approved: true,
    approvedAt: "2026-07-05T10:00:00.000Z",
    evidencePath,
    evidenceSha256,
    cutoverReason: "cutover_ready",
  }));
  if (options.writeReady !== false) {
    writeCutoverReadyEvidence({ stateDir, approvalPath, evidencePath, evidenceSha256 });
  }
}

describe("runtime-state postgres backend", () => {
  afterEach(() => {
    restoreEnv();
    vi.clearAllMocks();
  });

  it("loads primary runtime state through the async postgres path", async () => {
    process.env.RUNTIME_STATE_BACKEND = "postgres";
    process.env.DISPATCHER_PRIMARY_POSTGRES_URL = "postgres://localhost/forgeflow";
    const stateDir = makeStateDir();
    writeCutoverApproval(stateDir);
    const { loadRuntimeStateAsync } = await loadRuntimeStateModule();

    const state = await loadRuntimeStateAsync(stateDir);

    expect(mocks.createPgClient).toHaveBeenCalledWith("postgres://localhost/forgeflow");
    expect(mocks.loadPrimaryRuntimeStateSnapshot).toHaveBeenCalledWith(mocks.client);
    expect(mocks.client.end).toHaveBeenCalled();
    expect(state.sequence).toBe(7);
    expect(state.tasks[0]?.id).toBe("task-1");
    expect(state.workers).toEqual([]);
  });

  it("saves primary runtime state through the async postgres path", async () => {
    process.env.RUNTIME_STATE_BACKEND = "postgres";
    process.env.DISPATCHER_PRIMARY_POSTGRES_URL = "postgres://localhost/forgeflow";
    const stateDir = makeStateDir();
    writeCutoverApproval(stateDir);
    const { createEmptyRuntimeState, saveRuntimeStateAsync } = await loadRuntimeStateModule();
    const state = {
      ...createEmptyRuntimeState(),
      sequence: 11,
    };

    await saveRuntimeStateAsync(stateDir, state);

    expect(mocks.savePrimaryRuntimeStateSnapshot).toHaveBeenCalledWith(mocks.client, state, []);
    expect(mocks.client.end).toHaveBeenCalled();
  });

  it("rejects sync load when postgres backend is selected", async () => {
    process.env.RUNTIME_STATE_BACKEND = "postgres";
    const { loadRuntimeState } = await loadRuntimeStateModule();

    expect(() => loadRuntimeState("unused-state-dir")).toThrow("loadRuntimeStateAsync");
  });

  it("requires an explicit primary postgres URL", async () => {
    process.env.RUNTIME_STATE_BACKEND = "postgres";
    delete process.env.DISPATCHER_PRIMARY_POSTGRES_URL;
    const { loadRuntimeStateAsync } = await loadRuntimeStateModule();

    await expect(loadRuntimeStateAsync("unused-state-dir")).rejects.toThrow("DISPATCHER_PRIMARY_POSTGRES_URL");
  });

  it("requires archived cutover approval before using postgres as the primary backend", async () => {
    process.env.RUNTIME_STATE_BACKEND = "postgres";
    process.env.DISPATCHER_PRIMARY_POSTGRES_URL = "postgres://localhost/forgeflow";
    const { loadRuntimeStateAsync } = await loadRuntimeStateModule();

    await expect(loadRuntimeStateAsync(makeStateDir())).rejects.toThrow("shadow-cutover-approval.json");
    expect(mocks.createPgClient).not.toHaveBeenCalled();
  });

  it("requires final cutover ready evidence before using postgres as the primary backend", async () => {
    process.env.RUNTIME_STATE_BACKEND = "postgres";
    process.env.DISPATCHER_PRIMARY_POSTGRES_URL = "postgres://localhost/forgeflow";
    const stateDir = makeStateDir();
    writeCutoverApproval(stateDir, { writeReady: false });
    const { loadRuntimeStateAsync } = await loadRuntimeStateModule();

    await expect(loadRuntimeStateAsync(stateDir)).rejects.toThrow("shadow-cutover-ready.json");
    expect(mocks.createPgClient).not.toHaveBeenCalled();
  });

  it("rejects primary backend when ready evidence no longer matches approval evidence", async () => {
    process.env.RUNTIME_STATE_BACKEND = "postgres";
    process.env.DISPATCHER_PRIMARY_POSTGRES_URL = "postgres://localhost/forgeflow";
    const stateDir = makeStateDir();
    writeCutoverApproval(stateDir);
    const readyPath = path.join(stateDir, "shadow-cutover-ready.json");
    const ready = JSON.parse(fs.readFileSync(readyPath, "utf8"));
    ready.phases[1].payload.evidenceSha256 = "0".repeat(64);
    fs.writeFileSync(readyPath, `${JSON.stringify(ready)}\n`);
    const { loadRuntimeStateAsync } = await loadRuntimeStateModule();

    await expect(loadRuntimeStateAsync(stateDir)).rejects.toThrow("ready evidenceSha256");
    expect(mocks.createPgClient).not.toHaveBeenCalled();
  });

  it("rejects primary backend when ready evidence points at a different approval marker", async () => {
    process.env.RUNTIME_STATE_BACKEND = "postgres";
    process.env.DISPATCHER_PRIMARY_POSTGRES_URL = "postgres://localhost/forgeflow";
    const stateDir = makeStateDir();
    writeCutoverApproval(stateDir);
    const readyPath = path.join(stateDir, "shadow-cutover-ready.json");
    const ready = JSON.parse(fs.readFileSync(readyPath, "utf8"));
    ready.phases[1].payload.approvalPath = path.join(stateDir, "other-approval.json");
    fs.writeFileSync(readyPath, `${JSON.stringify(ready)}\n`);
    const { loadRuntimeStateAsync } = await loadRuntimeStateModule();

    await expect(loadRuntimeStateAsync(stateDir)).rejects.toThrow("approvalPath");
    expect(mocks.createPgClient).not.toHaveBeenCalled();
  });

  it("rejects primary backend when archived cutover evidence no longer matches approval", async () => {
    process.env.RUNTIME_STATE_BACKEND = "postgres";
    process.env.DISPATCHER_PRIMARY_POSTGRES_URL = "postgres://localhost/forgeflow";
    const stateDir = makeStateDir();
    writeCutoverApproval(stateDir);
    fs.writeFileSync(path.join(stateDir, "shadow-cutover-drill.json"), "{\"ok\":false}\n");
    const { loadRuntimeStateAsync } = await loadRuntimeStateModule();

    await expect(loadRuntimeStateAsync(stateDir)).rejects.toThrow("evidenceSha256");
    expect(mocks.createPgClient).not.toHaveBeenCalled();
  });

  it("rejects primary backend when cutover approval has been revoked", async () => {
    process.env.RUNTIME_STATE_BACKEND = "postgres";
    process.env.DISPATCHER_PRIMARY_POSTGRES_URL = "postgres://localhost/forgeflow";
    const stateDir = makeStateDir();
    writeCutoverApproval(stateDir);
    fs.writeFileSync(path.join(stateDir, "shadow-cutover-revocation.json"), JSON.stringify({
      revoked: true,
      revokedAt: "2026-07-05T11:00:00.000Z",
      reason: "operator_rollback",
    }));
    const { loadRuntimeStateAsync } = await loadRuntimeStateModule();

    await expect(loadRuntimeStateAsync(stateDir)).rejects.toThrow("shadow-cutover-revocation.json");
    expect(mocks.createPgClient).not.toHaveBeenCalled();
  });
});
