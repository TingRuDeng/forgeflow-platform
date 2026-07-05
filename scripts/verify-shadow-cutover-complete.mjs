#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");
const readyScriptPath = path.join(repoRoot, "scripts", "verify-shadow-cutover-ready.mjs");
const RUNTIME_STATE_BACKEND_ENV = "RUNTIME_STATE_BACKEND";
const PRIMARY_POSTGRES_URL_ENV = "DISPATCHER_PRIMARY_POSTGRES_URL";

function parseArgs(argv) {
  const stateDir = argv[0];
  if (!stateDir) {
    throw new Error("usage: node scripts/verify-shadow-cutover-complete.mjs <stateDir> [--output path]");
  }
  const options = { stateDir, outputPath: undefined };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output") {
      const outputPath = argv[index + 1];
      if (!outputPath) throw new Error("--output requires a path");
      options.outputPath = outputPath;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function parsePayload(stdout) {
  try {
    return JSON.parse(stdout || "{}");
  } catch {
    return { parseError: true, stdout };
  }
}

function runReadyPhase(stateDir) {
  const result = spawnSync(process.execPath, [readyScriptPath, stateDir], {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
    timeout: 60_000,
  });
  return {
    name: "ready_evidence",
    ok: result.status === 0,
    statusCode: result.status ?? 1,
    payload: parsePayload(result.stdout),
    stderr: result.stderr.trim() || undefined,
  };
}

function buildPrimaryBackendPhase() {
  const selected = process.env[RUNTIME_STATE_BACKEND_ENV] === "postgres";
  const configured = Boolean(process.env[PRIMARY_POSTGRES_URL_ENV]?.trim());
  const ok = selected && configured;
  return {
    name: "primary_backend",
    ok,
    statusCode: ok ? 0 : 2,
    payload: {
      selected,
      configured,
      reason: ok ? "primary_backend_configured" : selected ? "primary_postgres_url_missing" : "primary_backend_not_selected",
    },
  };
}

async function createPgClient() {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: process.env[PRIMARY_POSTGRES_URL_ENV] });
  await client.connect();
  return client;
}

function snapshotSummary(row) {
  const payload = row?.payload_json && typeof row.payload_json === "object" ? row.payload_json : {};
  return {
    hasSnapshot: Boolean(row),
    sequence: row ? Number(row.sequence ?? payload.sequence ?? 0) : null,
    updatedAt: row?.updated_at?.toISOString?.() ?? row?.updated_at ?? null,
    taskCount: Array.isArray(payload.tasks) ? payload.tasks.length : null,
    eventCount: Array.isArray(payload.events) ? payload.events.length : null,
  };
}

async function readPrimarySnapshotPhase(clientFactory) {
  let client;
  try {
    client = await clientFactory();
    const result = await client.query(`
      SELECT sequence, payload_json, updated_at
      FROM dispatcher_runtime_state
      WHERE id = 1
    `);
    const summary = snapshotSummary(result.rows[0]);
    return {
      name: "primary_snapshot",
      ok: summary.hasSnapshot,
      statusCode: summary.hasSnapshot ? 0 : 2,
      payload: { connected: true, ...summary },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      name: "primary_snapshot",
      ok: false,
      statusCode: 2,
      payload: { connected: false },
      stderr: message,
    };
  } finally {
    await client?.end?.();
  }
}

async function runCutoverComplete(options, deps = {}) {
  const readyPhase = deps.runReadyPhase?.(options.stateDir) ?? runReadyPhase(options.stateDir);
  const primaryBackendPhase = buildPrimaryBackendPhase();
  const phases = [readyPhase, primaryBackendPhase];
  if (primaryBackendPhase.ok) {
    phases.push(await readPrimarySnapshotPhase(deps.createPgClient ?? createPgClient));
  }
  return {
    ok: phases.every((phase) => phase.ok),
    stateDir: options.stateDir,
    completedAt: deps.now?.() ?? new Date().toISOString(),
    phases,
  };
}

function writeEvidenceFile(outputPath, result) {
  if (!outputPath) {
    return;
  }
  const resolvedPath = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const tempPath = `${resolvedPath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, resolvedPath);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await runCutoverComplete(options);
  writeEvidenceFile(options.outputPath, result);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

export { parseArgs, runCutoverComplete, writeEvidenceFile };
