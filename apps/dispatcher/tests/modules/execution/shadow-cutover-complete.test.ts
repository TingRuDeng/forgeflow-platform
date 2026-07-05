import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);
const scriptUrl = pathToFileURL(path.join(repoRoot, "scripts/verify-shadow-cutover-complete.mjs")).href;
const tmpRoots: string[] = [];
const originalBackend = process.env.RUNTIME_STATE_BACKEND;
const originalPrimaryUrl = process.env.DISPATCHER_PRIMARY_POSTGRES_URL;

function makeTempDir(): string {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-shadow-cutover-complete-"));
  tmpRoots.push(stateDir);
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

afterEach(() => {
  restoreEnv();
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("shadow cutover completion", () => {
  it("reports complete when ready evidence and primary snapshot are both readable", async () => {
    const mod = await import(scriptUrl);
    process.env.RUNTIME_STATE_BACKEND = "postgres";
    process.env.DISPATCHER_PRIMARY_POSTGRES_URL = "postgres://localhost/forgeflow";

    const result = await mod.runCutoverComplete({ stateDir: makeTempDir() }, {
      now: () => "2026-07-06T03:00:00.000Z",
      runReadyPhase: () => ({ name: "ready_evidence", ok: true, statusCode: 0, payload: { ok: true } }),
      createPgClient: async () => ({
        query: async () => ({
          rows: [{
            sequence: 42,
            updated_at: "2026-07-06T03:00:01.000Z",
            payload_json: { sequence: 42, tasks: [{ id: "task-1" }], events: [{ type: "created" }] },
          }],
        }),
        end: async () => {},
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      completedAt: "2026-07-06T03:00:00.000Z",
    });
    expect(result.phases.map((phase: { name: string }) => phase.name)).toEqual([
      "ready_evidence",
      "primary_backend",
      "primary_snapshot",
    ]);
    expect(result.phases[2].payload).toMatchObject({
      connected: true,
      hasSnapshot: true,
      sequence: 42,
      taskCount: 1,
      eventCount: 1,
    });
  });

  it("does not connect to Postgres when primary backend is not selected", async () => {
    const mod = await import(scriptUrl);
    delete process.env.RUNTIME_STATE_BACKEND;
    delete process.env.DISPATCHER_PRIMARY_POSTGRES_URL;

    const result = await mod.runCutoverComplete({ stateDir: makeTempDir() }, {
      runReadyPhase: () => ({ name: "ready_evidence", ok: true, statusCode: 0, payload: { ok: true } }),
      createPgClient: async () => {
        throw new Error("must not connect");
      },
    });

    expect(result.ok).toBe(false);
    expect(result.phases).toHaveLength(2);
    expect(result.phases[1]).toMatchObject({
      name: "primary_backend",
      ok: false,
      payload: { reason: "primary_backend_not_selected" },
    });
  });

  it("writes completion evidence to the requested output path", async () => {
    const mod = await import(scriptUrl);
    const outputPath = path.join(makeTempDir(), "evidence", "shadow-cutover-complete.json");
    const result = { ok: true, phases: [] };

    mod.writeEvidenceFile(outputPath, result);

    expect(JSON.parse(fs.readFileSync(outputPath, "utf8"))).toEqual(result);
  });
});
