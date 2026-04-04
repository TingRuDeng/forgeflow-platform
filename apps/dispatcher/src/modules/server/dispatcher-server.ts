// @ts-nocheck
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";

import { buildDashboardHtml } from "./dashboard.js";
import {
  beginTaskForWorker,
  buildDashboardSnapshot,
  claimAssignedTaskForWorker,
  createDispatch,
  disableWorker,
  enableWorker,
  heartbeatWorker,
  loadRuntimeState,
  reconcileRuntimeState,
  recordReviewDecision,
  recordWorkerResult,
  registerWorker,
  saveRuntimeState,
} from "./runtime-state.js";
import { handleTraeRoute } from "./runtime-dispatcher-server.js";
import {
  filterLessonsForInjection,
  injectLessonsIntoContext,
  loadMemoryStore,
} from "../../../../../scripts/lib/review-memory.js";
import { safeTaskDirName } from "../../../../../scripts/lib/task-worktree.js";
import { formatLocalTimestamp } from "../time.js";

const MAX_REQUEST_BODY_BYTES = 16 * 1024;

const AUTH_WHITELIST_PATHS = ["/health"];

type AuthMode = "legacy" | "token" | "open";

function getAuthMode(): AuthMode {
  const mode = process.env.DISPATCHER_AUTH_MODE?.toLowerCase();
  if (mode === "token" || mode === "open") {
    return mode as AuthMode;
  }
  return "legacy";
}

function getApiToken(): string | null {
  return process.env.DISPATCHER_API_TOKEN ?? null;
}

function checkAuthToken(authHeader: string | undefined, apiToken: string): boolean {
  if (!authHeader) {
    return false;
  }
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return false;
  }
  const token = match[1];
  return token === apiToken;
}

function createAuthMiddleware(input: { method: string; pathname: string; authHeader?: string }): null | { status: number; error: string } {
  const authMode = getAuthMode();

  if (authMode === "open") {
    return null;
  }

  if (authMode === "token") {
    const apiToken = getApiToken();
    if (!apiToken) {
      return {
        status: 500,
        error: "DISPATCHER_API_TOKEN is required when auth mode is 'token'",
      };
    }

    if (AUTH_WHITELIST_PATHS.includes(input.pathname)) {
      return null;
    }

    if (!checkAuthToken(input.authHeader, apiToken)) {
      return {
        status: 401,
        error: "unauthorized",
      };
    }
    return null;
  }

  const apiToken = getApiToken();
  if (!apiToken) {
    return null;
  }

  if (AUTH_WHITELIST_PATHS.includes(input.pathname)) {
    return null;
  }

  if (!checkAuthToken(input.authHeader, apiToken)) {
    return {
      status: 401,
      error: "unauthorized",
    };
  }

  return null;
}

function nowIso() {
  return formatLocalTimestamp();
}

function buildTraeWorktreeAndAssignmentDirs(stateDir, repoDir, task) {
  const baseWorktreeRoot = repoDir
    ? path.join(repoDir, ".worktrees")
    : path.join(stateDir, "..", "worktrees");
  const worktreeDir = path.join(baseWorktreeRoot, safeTaskDirName(task.id));
  const assignmentDir = path.join(
    worktreeDir,
    ".orchestrator",
    "assignments",
    safeTaskDirName(task.id)
  );
  return { worktree_dir: worktreeDir, assignment_dir: assignmentDir };
}

function normalizeDispatchBody(body) {
  if (!body || !Array.isArray(body.tasks) || !Array.isArray(body.packages)) {
    return body;
  }

  return {
    ...body,
    tasks: body.tasks.map((task) => {
      const targetWorkerId = task?.targetWorkerId ?? task?.target_worker_id ?? null;
      return targetWorkerId ? { ...task, targetWorkerId } : task;
    }),
    packages: body.packages.map((pkg) => {
      const assignment = pkg?.assignment ?? {};
      const targetWorkerId = assignment?.targetWorkerId ?? assignment?.target_worker_id ?? null;
      return targetWorkerId
        ? {
            ...pkg,
            assignment: {
              ...assignment,
              targetWorkerId,
            },
          }
        : pkg;
    }),
  };
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(`${JSON.stringify(value, null, 2)}\n`);
}

function createJsonResponse(status, value) {
  return {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    json: value,
    text: `${JSON.stringify(value, null, 2)}\n`,
  };
}

function classifyReviewDecisionError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.startsWith("task not found:")
    || message.startsWith("assignment not found for task:")
  ) {
    return 404;
  }
  if (message.startsWith("task not in review:")) {
    return 409;
  }
  return 500;
}

function createHtmlResponse(status, html) {
  return {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
    },
    html,
    text: html,
  };
}

function sendHtml(response, html) {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
  });
  response.end(html);
}

class PayloadTooLargeError extends Error {
  constructor(message = "payload_too_large") {
    super(message);
    this.name = "PayloadTooLargeError";
    this.code = "payload_too_large";
    this.status = 413;
  }
}

export async function readJsonBody(request, maxBytes = MAX_REQUEST_BODY_BYTES) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    totalBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
    if (totalBytes > maxBytes) {
      throw new PayloadTooLargeError();
    }
    chunks.push(chunk);
  }

  const payload = Buffer.concat(chunks).toString("utf8");
  if (!payload) {
    return {};
  }
  return JSON.parse(payload);
}

function withState(stateDir, callback) {
  const state = loadRuntimeState(stateDir);
  const result = callback(state);
  if (result?.state) {
    saveRuntimeState(stateDir, result.state);
  }
  return result;
}

function routeNotFound(response) {
  sendJson(response, 404, {
    error: "not_found",
  });
}

export function handleDispatcherHttpRequest(input) {
  const { stateDir, method, pathname, body = {}, authHeader } = input;

  const authError = createAuthMiddleware({ method, pathname, authHeader });
  if (authError) {
    return createJsonResponse(authError.status, { error: authError.error });
  }

  try {
    if (method === "GET" && pathname === "/health") {
      return createJsonResponse(200, { status: "ok" });
    }

    if (method === "GET" && pathname === "/dashboard") {
      return createHtmlResponse(200, buildDashboardHtml());
    }

    if (method === "GET" && pathname === "/api/dashboard/snapshot") {
      const snapshot = withState(stateDir, (state) => {
        const nextState = reconcileRuntimeState(state);
        return {
          state: nextState,
          snapshot: buildDashboardSnapshot(nextState),
        };
      });
      return createJsonResponse(200, snapshot.snapshot);
    }

    if (method === "GET" && pathname === "/api/workers") {
      const snapshot = withState(stateDir, (state) => {
        const nextState = reconcileRuntimeState(state);
        return {
          state: nextState,
          snapshot: buildDashboardSnapshot(nextState),
        };
      });
      return createJsonResponse(200, snapshot.snapshot.workers);
    }

    if (method === "POST" && pathname === "/api/workers/register") {
      const result = withState(stateDir, (state) => {
        const nextState = reconcileRuntimeState(registerWorker(state, body), {
          now: body.at,
        });
        return {
          state: nextState,
        };
      });
      return createJsonResponse(200, {
        status: "registered",
        workers: result.state.workers,
      });
    }

    const heartbeatMatch = method === "POST"
      ? pathname.match(/^\/api\/workers\/([^/]+)\/heartbeat$/)
      : null;
    if (heartbeatMatch) {
      const result = withState(stateDir, (state) => {
        const nextState = reconcileRuntimeState(heartbeatWorker(state, {
          workerId: decodeURIComponent(heartbeatMatch[1]),
          at: body.at,
        }), {
          now: body.at,
        });
        return {
          state: nextState,
        };
      });
      return createJsonResponse(200, {
        status: "heartbeat",
        workers: result.state.workers,
      });
    }

    const assignedMatch = method === "GET"
      ? pathname.match(/^\/api\/workers\/([^/]+)\/assigned-task$/)
      : null;
    if (assignedMatch) {
      const payload = withState(stateDir, (state) => claimAssignedTaskForWorker(state, {
        workerId: decodeURIComponent(assignedMatch[1]),
      }));
      return createJsonResponse(200, payload.assignment ?? { assignment: null });
    }

    const startMatch = method === "POST"
      ? pathname.match(/^\/api\/workers\/([^/]+)\/start-task$/)
      : null;
    if (startMatch) {
      const result = withState(stateDir, (state) => ({
        state: beginTaskForWorker(state, {
          workerId: decodeURIComponent(startMatch[1]),
          taskId: body.taskId,
          at: body.at,
        }),
      }));
      return createJsonResponse(200, {
        status: "started",
        tasks: result.state.tasks,
      });
    }

    const resultMatch = method === "POST"
      ? pathname.match(/^\/api\/workers\/([^/]+)\/result$/)
      : null;
    if (resultMatch) {
      const result = withState(stateDir, (state) => ({
        state: recordWorkerResult(state, {
          workerId: decodeURIComponent(resultMatch[1]),
          result: body.result,
          changedFiles: body.changedFiles,
          pullRequest: body.pullRequest,
        }),
      }));
      return createJsonResponse(200, {
        status: "result_recorded",
        tasks: result.state.tasks,
      });
    }

    const disableMatch = method === "POST"
      ? pathname.match(/^\/api\/workers\/([^/]+)\/disable$/)
      : null;
    if (disableMatch) {
      const result = withState(stateDir, (state) => ({
        state: disableWorker(state, {
          workerId: decodeURIComponent(disableMatch[1]),
          disabledBy: body.disabledBy,
          at: body.at,
        }),
      }));
      return createJsonResponse(200, {
        status: "disabled",
        workers: result.state.workers,
      });
    }

    const enableMatch = method === "POST"
      ? pathname.match(/^\/api\/workers\/([^/]+)\/enable$/)
      : null;
    if (enableMatch) {
      const result = withState(stateDir, (state) => ({
        state: enableWorker(state, {
          workerId: decodeURIComponent(enableMatch[1]),
          at: body.at,
        }),
      }));
      return createJsonResponse(200, {
        status: "enabled",
        workers: result.state.workers,
      });
    }

    if (method === "POST" && pathname === "/api/dispatches") {
      const memoryStore = loadMemoryStore(stateDir);
      const normalizedBody = normalizeDispatchBody(body);

      const result = withState(stateDir, (state) => {
        const dispatchResult = createDispatch(state, normalizedBody);

        if (memoryStore && memoryStore.lessons && memoryStore.lessons.length > 0) {
          for (const assignment of dispatchResult.state.assignments) {
            const task = dispatchResult.state.tasks.find((t) => t.id === assignment.taskId);
            if (!task) continue;

            const criteria = {
              repo: task.repo,
              scope: task.allowedPaths || [],
              category: undefined,
              worker_type: task.pool,
            };

            const relevantLessons = filterLessonsForInjection(
              memoryStore.lessons,
              criteria,
            );

            if (relevantLessons.length > 0) {
              const injectedContext = injectLessonsIntoContext(
                assignment.contextMarkdown || "",
                relevantLessons,
              );
              assignment.contextMarkdown = injectedContext;
              if (assignment.assignment) {
                assignment.assignment.contextMarkdown = injectedContext;
              }
            }
          }
        }

        return dispatchResult;
      });

      return createJsonResponse(200, {
        dispatchId: result.dispatchId,
        taskIds: result.taskIds,
        assignments: result.assignments,
      });
    }

    const reviewMatch = method === "POST"
      ? pathname.match(/^\/api\/reviews\/([^/]+)\/decision$/)
      : null;
    if (reviewMatch) {
      try {
        const result = withState(stateDir, (state) => ({
          state: recordReviewDecision(state, {
            taskId: decodeURIComponent(reviewMatch[1]),
            actor: body.actor,
            decision: body.decision,
            notes: body.notes,
            at: body.at,
          }),
        }));
        return createJsonResponse(200, {
          status: "decision_recorded",
          tasks: result.state.tasks,
        });
      } catch (error) {
        return createJsonResponse(classifyReviewDecisionError(error), {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const traeRoutes = [
      "/api/trae/register",
      "/api/trae/fetch-task",
      "/api/trae/start-task",
      "/api/trae/report-progress",
      "/api/trae/submit-result",
      "/api/trae/heartbeat",
    ];
    if (method === "POST" && traeRoutes.includes(pathname)) {
      try {
        const state = loadRuntimeState(stateDir);
        const handled = handleTraeRoute(state, { method, pathname, body });
        saveRuntimeState(stateDir, state);
        return handled;
      } catch (err) {
        console.error("[dispatcher-server] handleTraeRoute error:", err);
        return createJsonResponse(500, { error: err instanceof Error ? err.message : String(err) });
      }
    }

    return createJsonResponse(404, {
      error: "not_found",
    });
  } catch (error) {
    return createJsonResponse(500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function startDispatcherServer(input) {
  const host = input.host ?? "127.0.0.1";
  const port = input.port ?? 8787;
  const stateDir = input.stateDir;

  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);

    try {
      const body = request.method === "POST" ? await readJsonBody(request) : undefined;
      const authHeader = request.headers.authorization;
      const handled = handleDispatcherHttpRequest({
        stateDir,
        method: request.method ?? "GET",
        pathname: requestUrl.pathname,
        body,
        authHeader,
      });
      if (handled.headers["content-type"]?.startsWith("text/html")) {
        sendHtml(response, handled.text);
      } else {
        sendJson(response, handled.status, handled.json);
      }
    } catch (error) {
      if (error?.code === "payload_too_large") {
        sendJson(response, error.status ?? 413, {
          error: "payload_too_large",
        });
        return;
      }
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await new Promise((resolve) => {
    server.listen(port, host, resolve);
  });

  const address = server.address();
  const resolvedPort = typeof address === "object" && address ? address.port : port;

  return {
    server,
    host,
    port: resolvedPort,
    baseUrl: `http://${host}:${resolvedPort}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    }),
  };
}
