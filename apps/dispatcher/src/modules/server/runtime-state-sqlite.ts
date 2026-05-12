import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { AssignmentPayload, RuntimeState } from "./runtime-state.js";
import type { RuntimeStateStore } from "./runtime-state-store.js";
import { syncRuntimeStateShadow } from "./runtime-state-shadow.js";
import { formatLocalTimestamp } from "../time.js";

const { DatabaseSync } = await import("node:sqlite");

const STATE_FALLBACK_ENV = "FORGEFLOW_ALLOW_STATE_FALLBACK_JSON";
const SQLITE_BUSY_TIMEOUT_MS = 5_000;

function ignoreObservedShadowFailure(): void {}

function nowIso(): string {
  return formatLocalTimestamp();
}

function dbFilePath(stateDir: string): string {
  return path.join(stateDir, "runtime-state.db");
}

function stateFilePath(stateDir: string): string {
  return path.join(stateDir, "runtime-state.json");
}

function readOnlyDbUri(filePath: string): string {
  const url = pathToFileURL(filePath);
  url.searchParams.set("mode", "ro");
  url.searchParams.set("immutable", "1");
  return url.href;
}

function checksumSha256(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function parseJsonContent<T>(value: string, label: string): T {
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label}: ${message}`);
  }
}

function asJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function fromJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }
  return parseJsonContent<T>(value, "failed to parse structured runtime state JSON");
}

function applyPragmas(db: InstanceType<typeof DatabaseSync>): void {
  db.exec(`PRAGMA journal_mode = WAL;`);
  db.exec(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS};`);
}

function applyReadOnlyPragmas(db: InstanceType<typeof DatabaseSync>): void {
  db.exec(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS};`);
}

function initDb(db: InstanceType<typeof DatabaseSync>): void {
  applyPragmas(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      revision INTEGER PRIMARY KEY AUTOINCREMENT,
      data TEXT NOT NULL,
      checksum_sha256 TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workers (
      id TEXT PRIMARY KEY,
      pool TEXT NOT NULL,
      hostname TEXT NOT NULL,
      labels_json TEXT NOT NULL,
      repo_dir TEXT NOT NULL,
      status TEXT NOT NULL,
      last_heartbeat_at TEXT NOT NULL,
      current_task_id TEXT,
      disabled_at TEXT,
      disabled_by TEXT
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      external_task_id TEXT NOT NULL,
      trace_id TEXT,
      repo TEXT NOT NULL,
      default_branch TEXT NOT NULL,
      title TEXT NOT NULL,
      pool TEXT NOT NULL,
      allowed_paths_json TEXT NOT NULL,
      acceptance_json TEXT NOT NULL,
      depends_on_json TEXT NOT NULL,
      branch_name TEXT NOT NULL,
      target_worker_id TEXT,
      verification_json TEXT NOT NULL,
      chat_mode TEXT,
      continuation_mode TEXT,
      continue_from_task_id TEXT,
      follow_up_of_task_id TEXT,
      worker_change_reason TEXT,
      status TEXT NOT NULL,
      assigned_worker_id TEXT,
      last_assigned_worker_id TEXT,
      requested_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_attempts (
      attempt_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      attempt_no INTEGER NOT NULL,
      worker_id TEXT NOT NULL,
      worker_runtime TEXT NOT NULL,
      protocol_version TEXT NOT NULL,
      lease_token TEXT NOT NULL,
      status TEXT NOT NULL,
      trace_id TEXT NOT NULL,
      started_at TEXT,
      heartbeat_at TEXT,
      lease_expires_at TEXT,
      ended_at TEXT,
      failure_code TEXT,
      failure_message TEXT,
      artifact_bundle_id TEXT,
      idempotency_key TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS artifact_bundles (
      bundle_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      attempt_id TEXT NOT NULL,
      schema_version TEXT NOT NULL,
      summary TEXT,
      branch TEXT,
      commit_sha TEXT,
      pull_request_url TEXT,
      changed_files_json TEXT NOT NULL,
      refs_json TEXT NOT NULL,
      test_results_json TEXT,
      risk_notes_json TEXT NOT NULL,
      next_actions_json TEXT NOT NULL,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS assignments (
      task_id TEXT PRIMARY KEY,
      worker_id TEXT,
      pool TEXT NOT NULL,
      status TEXT NOT NULL,
      assignment_json TEXT NOT NULL,
      worker_prompt TEXT,
      context_markdown TEXT,
      worker_prompt_mode TEXT,
      report_schema_version TEXT,
      assigned_at TEXT,
      claimed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS reviews (
      task_id TEXT PRIMARY KEY,
      decision TEXT NOT NULL,
      actor TEXT,
      notes TEXT NOT NULL,
      decided_at TEXT,
      review_material_json TEXT,
      latest_worker_result_json TEXT,
      evidence_json TEXT
    );

    CREATE TABLE IF NOT EXISTS pull_requests (
      task_id TEXT PRIMARY KEY,
      number INTEGER NOT NULL,
      url TEXT NOT NULL,
      head_branch TEXT NOT NULL,
      base_branch TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dispatches (
      id TEXT PRIMARY KEY,
      repo TEXT NOT NULL,
      default_branch TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      task_ids_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS runtime_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      type TEXT NOT NULL,
      at TEXT NOT NULL,
      summary TEXT,
      payload_json TEXT
    );

    CREATE TABLE IF NOT EXISTS leases (
      id TEXT PRIMARY KEY,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      owner_token TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      renewed_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      released_at TEXT,
      reclaim_reason TEXT,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      renewed_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      released_at TEXT,
      metadata_json TEXT
    );
  `);
}

function createEmptyRuntimeState(): RuntimeState {
  return {
    version: 1,
    updatedAt: nowIso(),
    sequence: 0,
    workers: [],
    tasks: [],
    taskAttempts: [],
    artifactBundles: [],
    events: [],
    assignments: [],
    reviews: [],
    pullRequests: [],
    dispatches: [],
    leases: [],
  };
}

function coerceRuntimeState(parsed: unknown): RuntimeState {
  return {
    ...createEmptyRuntimeState(),
    ...(parsed as Partial<RuntimeState>),
    leases: Array.isArray((parsed as Partial<RuntimeState>)?.leases)
      ? (parsed as Partial<RuntimeState>).leases ?? []
      : [],
    taskAttempts: Array.isArray((parsed as Partial<RuntimeState>)?.taskAttempts)
      ? (parsed as Partial<RuntimeState>).taskAttempts ?? []
      : [],
    artifactBundles: Array.isArray((parsed as Partial<RuntimeState>)?.artifactBundles)
      ? (parsed as Partial<RuntimeState>).artifactBundles ?? []
      : [],
  };
}

function shouldAllowJsonFallback(): boolean {
  return process.env[STATE_FALLBACK_ENV] === "1";
}

function loadFromJsonFallback(stateDir: string, reason: unknown): RuntimeState {
  const jsonPath = stateFilePath(stateDir);
  if (!shouldAllowJsonFallback() || !fs.existsSync(jsonPath)) {
    const message = reason instanceof Error ? reason.message : String(reason);
    throw new Error(`failed to load runtime-state.db: ${message}`);
  }

  const jsonContent = fs.readFileSync(jsonPath, "utf8");
  return importFromJson(stateDir, jsonContent);
}

function rewriteStructuredProjection(
  db: InstanceType<typeof DatabaseSync>,
  state: RuntimeState,
): void {
  db.exec("BEGIN IMMEDIATE;");
  try {
    db.exec(`
      DELETE FROM workers;
      DELETE FROM tasks;
      DELETE FROM task_attempts;
      DELETE FROM assignments;
      DELETE FROM reviews;
      DELETE FROM pull_requests;
      DELETE FROM dispatches;
      DELETE FROM runtime_events;
      DELETE FROM leases;
      DELETE FROM sessions;
    `);

    const insertWorker = db.prepare(`
      INSERT INTO workers (
        id, pool, hostname, labels_json, repo_dir, status, last_heartbeat_at, current_task_id, disabled_at, disabled_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const worker of state.workers) {
      insertWorker.run(
        worker.id,
        worker.pool,
        worker.hostname,
        asJson(worker.labels),
        worker.repoDir,
        worker.status,
        worker.lastHeartbeatAt,
        worker.currentTaskId ?? null,
        worker.disabledAt ?? null,
        worker.disabledBy ?? null,
      );
    }

    const insertTask = db.prepare(`
      INSERT INTO tasks (
        id, external_task_id, trace_id, repo, default_branch, title, pool, allowed_paths_json, acceptance_json, depends_on_json,
        branch_name, target_worker_id, verification_json, chat_mode, continuation_mode, continue_from_task_id, follow_up_of_task_id,
        worker_change_reason, status, assigned_worker_id, last_assigned_worker_id, requested_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const task of state.tasks) {
      insertTask.run(
        task.id,
        task.externalTaskId,
        task.traceId ?? null,
        task.repo,
        task.defaultBranch,
        task.title,
        task.pool,
        asJson(task.allowedPaths),
        asJson(task.acceptance),
        asJson(task.dependsOn),
        task.branchName,
        task.targetWorkerId ?? null,
        asJson(task.verification),
        task.chatMode ?? null,
        task.continuationMode ?? null,
        task.continueFromTaskId ?? null,
        task.followUpOfTaskId ?? null,
        task.workerChangeReason ?? null,
        task.status,
        task.assignedWorkerId ?? null,
        task.lastAssignedWorkerId ?? null,
        task.requestedBy,
        task.createdAt,
      );
    }

    const insertTaskAttempt = db.prepare(`
      INSERT INTO task_attempts (
        attempt_id, task_id, attempt_no, worker_id, worker_runtime, protocol_version, lease_token, status, trace_id,
        started_at, heartbeat_at, lease_expires_at, ended_at, failure_code, failure_message, artifact_bundle_id, idempotency_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const attempt of state.taskAttempts ?? []) {
      insertTaskAttempt.run(
        attempt.attemptId,
        attempt.taskId,
        attempt.attemptNo,
        attempt.workerId,
        attempt.workerRuntime,
        attempt.protocolVersion,
        attempt.leaseToken,
        attempt.status,
        attempt.traceId,
        attempt.startedAt ?? null,
        attempt.heartbeatAt ?? null,
        attempt.leaseExpiresAt ?? null,
        attempt.endedAt ?? null,
        attempt.failureCode ?? null,
        attempt.failureMessage ?? null,
        attempt.artifactBundleId ?? null,
        attempt.idempotencyKey,
      );
    }

    const insertArtifactBundle = db.prepare(`
      INSERT INTO artifact_bundles (
        bundle_id, task_id, attempt_id, schema_version, summary, branch, commit_sha, pull_request_url,
        changed_files_json, refs_json, test_results_json, risk_notes_json, next_actions_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const bundle of state.artifactBundles ?? []) {
      insertArtifactBundle.run(
        bundle.bundleId ?? `${bundle.attemptId}:artifact-bundle`,
        bundle.taskId,
        bundle.attemptId,
        bundle.schemaVersion,
        bundle.summary ?? null,
        bundle.branch ?? null,
        bundle.commit ?? null,
        bundle.pullRequestUrl ?? null,
        asJson(bundle.changedFiles),
        asJson(bundle.refs),
        asJson(bundle.testResults ?? null),
        asJson(bundle.riskNotes ?? []),
        asJson(bundle.nextActions ?? []),
        bundle.createdAt ?? null,
      );
    }

    const insertAssignment = db.prepare(`
      INSERT INTO assignments (
        task_id, worker_id, pool, status, assignment_json, worker_prompt, context_markdown, worker_prompt_mode,
        report_schema_version, assigned_at, claimed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const assignment of state.assignments) {
      insertAssignment.run(
        assignment.taskId,
        assignment.workerId ?? null,
        assignment.pool,
        assignment.status,
        asJson(assignment.assignment),
        assignment.workerPrompt ?? null,
        assignment.contextMarkdown ?? null,
        assignment.workerPromptMode ?? null,
        assignment.reportSchemaVersion ?? null,
        assignment.assignedAt ?? null,
        assignment.claimedAt ?? null,
      );
    }

    const insertReview = db.prepare(`
      INSERT INTO reviews (
        task_id, decision, actor, notes, decided_at, review_material_json, latest_worker_result_json, evidence_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const review of state.reviews) {
      insertReview.run(
        review.taskId,
        review.decision,
        review.actor ?? null,
        review.notes,
        review.decidedAt ?? null,
        asJson(review.reviewMaterial ?? null),
        asJson(review.latestWorkerResult ?? null),
        asJson(review.evidence ?? null),
      );
    }

    const insertPullRequest = db.prepare(`
      INSERT INTO pull_requests (
        task_id, number, url, head_branch, base_branch, title, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const pullRequest of state.pullRequests) {
      insertPullRequest.run(
        pullRequest.taskId,
        pullRequest.number,
        pullRequest.url,
        pullRequest.headBranch,
        pullRequest.baseBranch,
        pullRequest.title,
        pullRequest.status,
        pullRequest.createdAt,
        pullRequest.updatedAt,
      );
    }

    const insertDispatch = db.prepare(`
      INSERT INTO dispatches (id, repo, default_branch, requested_by, created_at, task_ids_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const dispatch of state.dispatches) {
      insertDispatch.run(
        dispatch.id,
        dispatch.repo,
        dispatch.defaultBranch,
        dispatch.requestedBy,
        dispatch.createdAt,
        asJson(dispatch.taskIds),
      );
    }

    const insertEvent = db.prepare(`
      INSERT INTO runtime_events (task_id, type, at, summary, payload_json)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const event of state.events) {
      insertEvent.run(
        event.taskId,
        event.type,
        event.at,
        event.summary ?? null,
        asJson(event.payload ?? null),
      );
    }

    const insertLease = db.prepare(`
      INSERT INTO leases (
        id, resource_type, resource_id, owner_id, owner_token, acquired_at, renewed_at, expires_at, released_at, reclaim_reason, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const lease of state.leases ?? []) {
      insertLease.run(
        lease.id,
        lease.resourceType,
        lease.resourceId,
        lease.ownerId,
        lease.ownerToken,
        lease.acquiredAt,
        lease.renewedAt,
        lease.expiresAt,
        lease.releasedAt ?? null,
        lease.reclaimReason ?? null,
        asJson(lease.metadata ?? null),
      );
    }

    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

export function loadRuntimeState(stateDir: string): RuntimeState {
  const filePath = dbFilePath(stateDir);
  if (!fs.existsSync(filePath)) {
    if (fs.existsSync(stateFilePath(stateDir))) {
      const jsonContent = fs.readFileSync(stateFilePath(stateDir), "utf8");
      return importFromJson(stateDir, jsonContent);
    }
    return createEmptyRuntimeState();
  }

  let db: InstanceType<typeof DatabaseSync> | null = null;
  try {
    db = new DatabaseSync(readOnlyDbUri(filePath), { readOnly: true });
    applyReadOnlyPragmas(db);
    const row = db
      .prepare(
        "SELECT revision, data, checksum_sha256, created_at FROM snapshots ORDER BY revision DESC LIMIT 1",
      )
      .get() as
      | {
          revision: number;
          data: string;
          checksum_sha256: string;
          created_at: string;
        }
      | undefined;

    if (!row) {
      throw new Error("snapshots table is empty");
    }

    const actualChecksum = checksumSha256(row.data);
    if (actualChecksum !== row.checksum_sha256) {
      throw new Error(`snapshot checksum mismatch at revision ${row.revision}`);
    }

    return coerceRuntimeState(
      parseJsonContent(row.data, `failed to parse snapshot at revision ${row.revision}`),
    );
  } catch (error) {
    return loadFromJsonFallback(stateDir, error);
  } finally {
    db?.close();
  }
}

export function saveRuntimeState(stateDir: string, state: RuntimeState): void {
  fs.mkdirSync(stateDir, { recursive: true });
  const filePath = dbFilePath(stateDir);
  const db = new DatabaseSync(filePath);

  try {
    initDb(db);

    const persistedState = {
      ...state,
      updatedAt: nowIso(),
      leases: state.leases ?? [],
    };
    const content = JSON.stringify(persistedState);
    const createdAt = nowIso();
    const checksum = checksumSha256(content);

    db.prepare(`
      INSERT INTO snapshots (data, checksum_sha256, created_at)
      VALUES (?, ?, ?)
    `).run(content, checksum, createdAt);

    rewriteStructuredProjection(db, persistedState);
    void syncRuntimeStateShadow(persistedState).catch(ignoreObservedShadowFailure);
  } finally {
    db.close();
  }
}

export function importFromJson(stateDir: string, jsonContent: string): RuntimeState {
  const state = coerceRuntimeState(
    parseJsonContent(jsonContent, "failed to parse JSON import content"),
  );
  const filePath = dbFilePath(stateDir);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  saveRuntimeState(stateDir, state);
  return loadRuntimeState(stateDir);
}

export function readStructuredRuntimeState(stateDir: string): RuntimeState {
  const filePath = dbFilePath(stateDir);
  if (!fs.existsSync(filePath)) {
    return createEmptyRuntimeState();
  }

  const db = new DatabaseSync(readOnlyDbUri(filePath), { readOnly: true });
  try {
    applyReadOnlyPragmas(db);

    const base = createEmptyRuntimeState();

    base.workers = db.prepare(`
      SELECT id, pool, hostname, labels_json, repo_dir, status, last_heartbeat_at, current_task_id, disabled_at, disabled_by
      FROM workers
      ORDER BY id
    `).all().map((row: any) => ({
      id: row.id,
      pool: row.pool,
      hostname: row.hostname,
      labels: fromJson(row.labels_json, []),
      repoDir: row.repo_dir,
      status: row.status,
      lastHeartbeatAt: row.last_heartbeat_at,
      currentTaskId: row.current_task_id ?? undefined,
      disabledAt: row.disabled_at ?? null,
      disabledBy: row.disabled_by ?? null,
    }));

    base.tasks = db.prepare(`
      SELECT *
      FROM tasks
      ORDER BY created_at, id
    `).all().map((row: any) => ({
      id: row.id,
      externalTaskId: row.external_task_id,
      traceId: row.trace_id ?? null,
      repo: row.repo,
      defaultBranch: row.default_branch,
      title: row.title,
      pool: row.pool,
      allowedPaths: fromJson(row.allowed_paths_json, []),
      acceptance: fromJson(row.acceptance_json, []),
      dependsOn: fromJson(row.depends_on_json, []),
      branchName: row.branch_name,
      targetWorkerId: row.target_worker_id ?? null,
      verification: fromJson(row.verification_json, { mode: "run" }),
      chatMode: row.chat_mode ?? undefined,
      continuationMode: row.continuation_mode ?? undefined,
      continueFromTaskId: row.continue_from_task_id ?? null,
      followUpOfTaskId: row.follow_up_of_task_id ?? null,
      workerChangeReason: row.worker_change_reason ?? null,
      status: row.status,
      assignedWorkerId: row.assigned_worker_id ?? null,
      lastAssignedWorkerId: row.last_assigned_worker_id ?? null,
      requestedBy: row.requested_by,
      createdAt: row.created_at,
    }));

    base.taskAttempts = db.prepare(`
      SELECT *
      FROM task_attempts
      ORDER BY task_id, attempt_no
    `).all().map((row: any) => ({
      attemptId: row.attempt_id,
      taskId: row.task_id,
      attemptNo: row.attempt_no,
      workerId: row.worker_id,
      workerRuntime: row.worker_runtime,
      protocolVersion: row.protocol_version,
      leaseToken: row.lease_token,
      status: row.status,
      traceId: row.trace_id,
      startedAt: row.started_at ?? undefined,
      heartbeatAt: row.heartbeat_at ?? undefined,
      leaseExpiresAt: row.lease_expires_at ?? undefined,
      endedAt: row.ended_at ?? undefined,
      failureCode: row.failure_code ?? undefined,
      failureMessage: row.failure_message ?? undefined,
      artifactBundleId: row.artifact_bundle_id ?? undefined,
      idempotencyKey: row.idempotency_key,
    }));

    base.artifactBundles = db.prepare(`
      SELECT *
      FROM artifact_bundles
      ORDER BY task_id, attempt_id, bundle_id
    `).all().map((row: any) => ({
      bundleId: row.bundle_id,
      taskId: row.task_id,
      attemptId: row.attempt_id,
      schemaVersion: row.schema_version,
      summary: row.summary ?? undefined,
      branch: row.branch ?? undefined,
      commit: row.commit_sha ?? undefined,
      pullRequestUrl: row.pull_request_url ?? undefined,
      changedFiles: fromJson(row.changed_files_json, []),
      refs: fromJson(row.refs_json, {}),
      testResults: fromJson(row.test_results_json, undefined),
      riskNotes: fromJson(row.risk_notes_json, []),
      nextActions: fromJson(row.next_actions_json, []),
      createdAt: row.created_at ?? undefined,
    }));

    base.assignments = db.prepare(`
      SELECT *
      FROM assignments
      ORDER BY task_id
    `).all().map((row: any) => ({
      taskId: row.task_id,
      workerId: row.worker_id ?? null,
      pool: row.pool,
      status: row.status,
      assignment: fromJson<AssignmentPayload>(row.assignment_json, {
        taskId: row.task_id,
        workerId: row.worker_id ?? null,
        pool: row.pool,
        status: row.status,
        branchName: "",
        repo: "",
        defaultBranch: "",
      }),
      workerPrompt: row.worker_prompt ?? undefined,
      contextMarkdown: row.context_markdown ?? undefined,
      workerPromptMode: row.worker_prompt_mode ?? undefined,
      reportSchemaVersion: row.report_schema_version ?? undefined,
      assignedAt: row.assigned_at ?? null,
      claimedAt: row.claimed_at ?? null,
    }));

    base.reviews = db.prepare(`
      SELECT *
      FROM reviews
      ORDER BY task_id
    `).all().map((row: any) => ({
      taskId: row.task_id,
      decision: row.decision,
      actor: row.actor ?? null,
      notes: row.notes,
      decidedAt: row.decided_at ?? null,
      reviewMaterial: fromJson(row.review_material_json, null),
      latestWorkerResult: fromJson(row.latest_worker_result_json, null),
      evidence: fromJson(row.evidence_json, null),
    }));

    base.pullRequests = db.prepare(`
      SELECT *
      FROM pull_requests
      ORDER BY created_at, task_id
    `).all().map((row: any) => ({
      taskId: row.task_id,
      number: row.number,
      url: row.url,
      headBranch: row.head_branch,
      baseBranch: row.base_branch,
      title: row.title,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    base.dispatches = db.prepare(`
      SELECT *
      FROM dispatches
      ORDER BY created_at, id
    `).all().map((row: any) => ({
      id: row.id,
      repo: row.repo,
      defaultBranch: row.default_branch,
      requestedBy: row.requested_by,
      createdAt: row.created_at,
      taskIds: fromJson(row.task_ids_json, []),
    }));

    base.events = db.prepare(`
      SELECT task_id, type, at, summary, payload_json
      FROM runtime_events
      ORDER BY seq
    `).all().map((row: any) => ({
      taskId: row.task_id,
      type: row.type,
      at: row.at,
      summary: row.summary ?? null,
      payload: fromJson(row.payload_json, null),
    }));

    base.leases = db.prepare(`
      SELECT *
      FROM leases
      ORDER BY resource_type, resource_id
    `).all().map((row: any) => ({
      id: row.id,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      ownerId: row.owner_id,
      ownerToken: row.owner_token,
      acquiredAt: row.acquired_at,
      renewedAt: row.renewed_at,
      expiresAt: row.expires_at,
      releasedAt: row.released_at ?? null,
      reclaimReason: row.reclaim_reason ?? null,
      metadata: fromJson(row.metadata_json, null),
    }));

    const latestSnapshot = db.prepare(`
      SELECT data
      FROM snapshots
      ORDER BY revision DESC
      LIMIT 1
    `).get() as { data: string } | undefined;
    if (latestSnapshot) {
      const parsed = coerceRuntimeState(
        parseJsonContent(latestSnapshot.data, "failed to parse latest structured snapshot"),
      );
      base.version = parsed.version;
      base.updatedAt = parsed.updatedAt;
      base.sequence = parsed.sequence;
    }

    return base;
  } finally {
    db.close();
  }
}

export function compareStructuredProjection(stateDir: string): {
  matches: boolean;
  expected: Record<string, number>;
  actual: Record<string, number>;
} {
  const snapshot = loadRuntimeState(stateDir);
  const structured = readStructuredRuntimeState(stateDir);
  const expected = {
    workers: snapshot.workers.length,
    tasks: snapshot.tasks.length,
    taskAttempts: (snapshot.taskAttempts ?? []).length,
    artifactBundles: (snapshot.artifactBundles ?? []).length,
    assignments: snapshot.assignments.length,
    reviews: snapshot.reviews.length,
    pullRequests: snapshot.pullRequests.length,
    dispatches: snapshot.dispatches.length,
    events: snapshot.events.length,
    leases: (snapshot.leases ?? []).length,
  };
  const actual = {
    workers: structured.workers.length,
    tasks: structured.tasks.length,
    taskAttempts: (structured.taskAttempts ?? []).length,
    artifactBundles: (structured.artifactBundles ?? []).length,
    assignments: structured.assignments.length,
    reviews: structured.reviews.length,
    pullRequests: structured.pullRequests.length,
    dispatches: structured.dispatches.length,
    events: structured.events.length,
    leases: (structured.leases ?? []).length,
  };

  return {
    matches: Object.keys(expected).every((key) => expected[key as keyof typeof expected] === actual[key as keyof typeof actual]),
    expected,
    actual,
  };
}

export const sqliteStore: RuntimeStateStore & {
  importFromJson: typeof importFromJson;
  readStructuredRuntimeState: typeof readStructuredRuntimeState;
  compareStructuredProjection: typeof compareStructuredProjection;
} = {
  load: loadRuntimeState,
  save: saveRuntimeState,
  createEmpty: createEmptyRuntimeState,
  importFromJson,
  readStructuredRuntimeState,
  compareStructuredProjection,
};
