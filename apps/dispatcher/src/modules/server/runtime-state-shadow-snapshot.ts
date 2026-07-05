import type { RuntimeState } from "./runtime-state.js";

export function buildRuntimeStateProjectionSnapshot(state: RuntimeState) {
  return {
    tables: [
      {
        name: "dispatcher_workers",
        truncateSql: "TRUNCATE dispatcher_workers",
        insertSql: `
          INSERT INTO dispatcher_workers (id, payload_json)
          VALUES ($1, $2::jsonb)
        `,
        rows: state.workers.map((worker) => [worker.id, JSON.stringify(worker)]),
      },
      {
        name: "dispatcher_tasks",
        truncateSql: "TRUNCATE dispatcher_tasks",
        insertSql: `
          INSERT INTO dispatcher_tasks (id, payload_json)
          VALUES ($1, $2::jsonb)
        `,
        rows: state.tasks.map((task) => [task.id, JSON.stringify(task)]),
      },
      {
        name: "dispatcher_assignments",
        truncateSql: "TRUNCATE dispatcher_assignments",
        insertSql: `
          INSERT INTO dispatcher_assignments (task_id, payload_json)
          VALUES ($1, $2::jsonb)
        `,
        rows: state.assignments.map((assignment) => [assignment.taskId, JSON.stringify(assignment)]),
      },
      {
        name: "dispatcher_reviews",
        truncateSql: "TRUNCATE dispatcher_reviews",
        insertSql: `
          INSERT INTO dispatcher_reviews (task_id, payload_json)
          VALUES ($1, $2::jsonb)
        `,
        rows: state.reviews.map((review) => [review.taskId, JSON.stringify(review)]),
      },
      {
        name: "dispatcher_events",
        truncateSql: "TRUNCATE dispatcher_events",
        insertSql: `
          INSERT INTO dispatcher_events (event_id, task_id, event_at, payload_json)
          VALUES ($1, $2, $3, $4::jsonb)
        `,
        rows: state.events.map((event, index) => [
          `${event.taskId}:${event.type}:${event.at}:${index}`,
          event.taskId,
          event.at,
          JSON.stringify(event),
        ]),
      },
      {
        name: "dispatcher_leases",
        truncateSql: "TRUNCATE dispatcher_leases",
        insertSql: `
          INSERT INTO dispatcher_leases (id, payload_json)
          VALUES ($1, $2::jsonb)
        `,
        rows: (state.leases ?? []).map((lease) => [lease.id, JSON.stringify(lease)]),
      },
    ],
    counts: {
      dispatcher_workers: state.workers.length,
      dispatcher_tasks: state.tasks.length,
      dispatcher_assignments: state.assignments.length,
      dispatcher_reviews: state.reviews.length,
      dispatcher_events: state.events.length,
      dispatcher_leases: (state.leases ?? []).length,
    },
  };
}

export function buildAssignmentQueueShadowSnapshot(state: RuntimeState) {
  const availableAt = state.updatedAt;
  return {
    queueName: "assignment_delivery",
    rows: state.assignments
      .filter((assignment) => assignment.status === "pending" || assignment.status === "assigned")
      .map((assignment) => ({
        queueName: "assignment_delivery",
        messageId: assignment.taskId,
        taskId: assignment.taskId,
        workerId: assignment.workerId ?? null,
        status: assignment.status,
        availableAt,
        payload: assignment.assignment as unknown as Record<string, unknown>,
      })),
  };
}

export function buildAssignmentQueueExpectedCounts(state: RuntimeState): Record<string, number> {
  return {
    assignment_delivery: buildAssignmentQueueShadowSnapshot(state).rows.length,
  };
}

export async function ensureRuntimeStateProjectionTables(client: { query(sql: string): Promise<unknown> }) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS dispatcher_workers (
      id TEXT PRIMARY KEY,
      payload_json JSONB NOT NULL
    );
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS dispatcher_tasks (
      id TEXT PRIMARY KEY,
      payload_json JSONB NOT NULL
    );
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS dispatcher_assignments (
      task_id TEXT PRIMARY KEY,
      payload_json JSONB NOT NULL
    );
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS dispatcher_reviews (
      task_id TEXT PRIMARY KEY,
      payload_json JSONB NOT NULL
    );
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS dispatcher_events (
      event_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      event_at TIMESTAMPTZ NOT NULL,
      payload_json JSONB NOT NULL
    );
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS dispatcher_leases (
      id TEXT PRIMARY KEY,
      payload_json JSONB NOT NULL
    );
  `);
}
