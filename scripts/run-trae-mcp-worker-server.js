#!/usr/bin/env node
const DEFAULT_DISPATCHER_URL = "http://127.0.0.1:8787";
const HIGH_HEARTBEAT_INTERVAL_MS = 10_000;
const IDLE_HEARTBEAT_INTERVAL_MS = 10_000;
const TOOLS = [
    {
        name: "register",
        description: "Register this Trae worker with the dispatcher.",
        inputSchema: {
            type: "object",
            properties: {
                worker_id: { type: "string", description: "Unique identifier for this worker" },
                pool: { type: "string", description: "Worker pool (e.g., 'trae', 'codex')" },
                repo_dir: { type: "string", description: "Path to the repository directory" },
                labels: { type: "array", items: { type: "string" }, description: "Optional labels" },
            },
            required: ["worker_id", "pool", "repo_dir"],
        },
    },
    {
        name: "fetch_task",
        description: "Fetch an assigned task. Returns worktree_dir, assignment_dir, and constraints.",
        inputSchema: {
            type: "object",
            properties: {
                worker_id: { type: "string", description: "The Trae worker ID" },
                repo_dir: { type: "string", description: "Absolute path to the repository directory on this machine" },
            },
            required: ["worker_id"],
        },
    },
    {
        name: "start_task",
        description: "Mark a task as started. Automatically begins sending heartbeats.",
        inputSchema: {
            type: "object",
            properties: {
                worker_id: { type: "string", description: "Worker ID" },
                task_id: { type: "string", description: "Task ID to start" },
            },
            required: ["worker_id", "task_id"],
        },
    },
    {
        name: "report_progress",
        description: "Report progress message for a running task.",
        inputSchema: {
            type: "object",
            properties: {
                task_id: { type: "string", description: "The task ID" },
                message: { type: "string", description: "Progress message" },
            },
            required: ["task_id", "message"],
        },
    },
    {
        name: "submit_result",
        description: "Submit the result. This demotes to idle heartbeat instead of stopping.",
        inputSchema: {
            type: "object",
            properties: {
                worker_id: { type: "string", description: "Worker ID" },
                task_id: { type: "string", description: "The task ID" },
                status: {
                    type: "string",
                    enum: ["review_ready", "failed"],
                    description: "Task status: review_ready or failed",
                },
                summary: { type: "string", description: "Summary of the work done" },
                test_output: { type: "string", description: "Test command output" },
                risks: { type: "array", items: { type: "string" }, description: "Potential risks" },
                files_changed: { type: "array", items: { type: "string" }, description: "List of changed files" },
                branch_name: { type: "string", description: "Branch name where changes were committed" },
                commit_sha: { type: "string", description: "Latest commit SHA" },
                push_status: { type: "string", enum: ["success", "failed", "not_attempted"], description: "Push status" },
                push_error: { type: "string", description: "Error message if push failed" },
                pr_number: { type: "number", description: "PR number if PR was created" },
                pr_url: { type: "string", description: "PR URL if available" },
            },
            required: ["worker_id", "task_id", "status"],
        },
    },
    {
        name: "heartbeat",
        description: "Send heartbeat. Usually not needed as it's automatic after start_task.",
        inputSchema: {
            type: "object",
            properties: {
                worker_id: { type: "string", description: "The Trae worker ID" },
            },
            required: ["worker_id"],
        },
    },
];
let heartbeatInterval = null;
let currentWorkerId = null;
let currentTaskId = null;
let currentHeartbeatMode = "idle";
function parseArgs() {
    const args = process.argv.slice(2);
    let dispatcherUrl = DEFAULT_DISPATCHER_URL;
    let workerId = "trae-auto";
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--dispatcher-url" && i + 1 < args.length) {
            dispatcherUrl = args[i + 1];
            i++;
        }
        else if (arg === "--worker-id" && i + 1 < args.length) {
            workerId = args[i + 1];
            i++;
        }
        else if (arg === "--help" || arg === "-h") {
            console.log(`Usage: node run-trae-mcp-worker-server.js [options]
Options:
  --dispatcher-url URL   Dispatcher server URL (default: ${DEFAULT_DISPATCHER_URL})
  --worker-id ID        Worker ID (default: trae-auto)
  --help, -h           Show this help message`);
            process.exit(0);
        }
    }
    return { dispatcherUrl, workerId };
}
function createHttpClient(baseUrl) {
    const base = baseUrl.replace(/\/$/, "");
    async function request(path, body) {
        const url = `${base}${path}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            if (!response.ok) {
                const text = await response.text();
                throw new Error(`HTTP ${response.status}: ${text || response.statusText}`);
            }
            return await response.json();
        }
        catch (error) {
            clearTimeout(timeoutId);
            if (error instanceof Error) {
                if (error.name === "AbortError") {
                    throw new Error(`Request timeout: ${path}`);
                }
                throw new Error(`Dispatcher request failed: ${error.message}`);
            }
            throw new Error(`Dispatcher request failed: ${String(error)}`);
        }
    }
    return {
        async register(worker) {
            return request("/api/trae/register", {
                worker_id: worker.workerId,
                pool: worker.pool,
                repo_dir: worker.repoDir,
                labels: worker.labels,
            });
        },
        async fetchTask(workerId, repoDir) {
            return request("/api/trae/fetch-task", { worker_id: workerId, repo_dir: repoDir });
        },
        async startTask(workerId, taskId) {
            return request("/api/trae/start-task", { worker_id: workerId, task_id: taskId });
        },
        async reportProgress(taskId, message) {
            return request("/api/trae/report-progress", { task_id: taskId, message });
        },
        async submitResult(input) {
            return request("/api/trae/submit-result", {
                task_id: input.taskId,
                status: input.status,
                summary: input.summary,
                test_output: input.testOutput,
                risks: input.risks,
                files_changed: input.filesChanged,
                branch_name: input.github?.branchName,
                commit_sha: input.github?.commitSha,
                push_status: input.github?.pushStatus,
                push_error: input.github?.pushError,
                pr_number: input.github?.prNumber,
                pr_url: input.github?.prUrl,
            });
        },
        async heartbeat(workerId) {
            return request("/api/trae/heartbeat", { worker_id: workerId });
        },
    };
}
function startHeartbeat(httpClient, workerId, mode = "high") {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
    }
    currentWorkerId = workerId;
    currentHeartbeatMode = mode;
    const intervalMs = mode === "high" ? HIGH_HEARTBEAT_INTERVAL_MS : IDLE_HEARTBEAT_INTERVAL_MS;
    heartbeatInterval = setInterval(async () => {
        try {
            await httpClient.heartbeat(workerId);
        }
        catch (error) {
            console.error(`[Trae MCP] Heartbeat failed:`, error instanceof Error ? error.message : String(error));
        }
    }, intervalMs);
    console.error(`[Trae MCP] Heartbeat started for worker: ${workerId}, mode: ${mode}`);
}
function promoteToIdleHeartbeat(httpClient) {
    if (currentWorkerId && currentHeartbeatMode === "high") {
        startHeartbeat(httpClient, currentWorkerId, "idle");
    }
}
function stopHeartbeat() {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
        console.error(`[Trae MCP] Heartbeat stopped`);
    }
}
const JSONRPC_VERSION = "2.0";
function createResponse(id, result) {
    return {
        jsonrpc: JSONRPC_VERSION,
        id,
        result,
    };
}
function createErrorResponse(id, code, message) {
    return {
        jsonrpc: JSONRPC_VERSION,
        id,
        error: {
            code,
            message,
        },
    };
}
async function handleRequest(httpClient, request) {
    const { jsonrpc, id, method, params } = request;
    if (jsonrpc !== JSONRPC_VERSION) {
        return createErrorResponse(id, -32600, "Invalid JSON-RPC version");
    }
    if (method === "initialize") {
        return createResponse(id, {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "forgeflow-trae-worker", version: "0.2.0" },
        });
    }
    if (method === "tools/list") {
        return createResponse(id, { tools: TOOLS });
    }
    if (method === "tools/call") {
        const { name, arguments: args } = params;
        try {
            let result;
            switch (name) {
                case "register":
                    result = await httpClient.register({
                        workerId: args.worker_id,
                        pool: args.pool,
                        repoDir: args.repo_dir,
                        labels: args.labels,
                    });
                    startHeartbeat(httpClient, args.worker_id, "idle");
                    break;
                case "fetch_task":
                    result = await httpClient.fetchTask(args.worker_id, args.repo_dir);
                    break;
                case "start_task":
                    result = await httpClient.startTask(args.worker_id, args.task_id);
                    startHeartbeat(httpClient, args.worker_id);
                    currentTaskId = args.task_id;
                    break;
                case "report_progress":
                    result = await httpClient.reportProgress(args.task_id, args.message);
                    break;
                case "submit_result":
                    result = await httpClient.submitResult({
                        taskId: args.task_id,
                        status: args.status,
                        summary: args.summary,
                        testOutput: args.test_output,
                        risks: args.risks,
                        filesChanged: args.files_changed,
                        github: {
                            branchName: args.branch_name,
                            commitSha: args.commit_sha,
                            pushStatus: args.push_status,
                            pushError: args.push_error,
                            prNumber: args.pr_number,
                            prUrl: args.pr_url,
                        },
                    });
                    if (result.ok) {
                        promoteToIdleHeartbeat(httpClient);
                    }
                    break;
                case "heartbeat":
                    result = await httpClient.heartbeat(args.worker_id);
                    break;
                default:
                    return createErrorResponse(id, -32601, `Unknown tool: ${name}`);
            }
            return createResponse(id, {
                content: [{ type: "text", text: JSON.stringify(result) }],
            });
        }
        catch (error) {
            return createResponse(id, {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
                    },
                ],
                isError: true,
            });
        }
    }
    if (method === "notifications/initialized") {
        return null;
    }
    return createErrorResponse(id, -32601, `Unknown method: ${method}`);
}
async function main() {
    const { dispatcherUrl, workerId } = parseArgs();
    console.error(`[Trae MCP] Starting with dispatcher: ${dispatcherUrl}, workerId: ${workerId}`, JSON.stringify({ type: "notification", method: "initialized" }));
    const httpClient = createHttpClient(dispatcherUrl);
    let requestBuffer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
        requestBuffer += chunk;
        let newlineIndex;
        while ((newlineIndex = requestBuffer.indexOf("\n")) !== -1) {
            const line = requestBuffer.slice(0, newlineIndex);
            requestBuffer = requestBuffer.slice(newlineIndex + 1);
            if (!line.trim())
                continue;
            try {
                const request = JSON.parse(line);
                handleRequest(httpClient, request)
                    .then((response) => {
                    if (response) {
                        console.log(JSON.stringify(response));
                    }
                })
                    .catch((error) => {
                    const errorResponse = createErrorResponse(request.id ?? null, -32603, error instanceof Error ? error.message : String(error));
                    console.log(JSON.stringify(errorResponse));
                });
            }
            catch (error) {
                console.error("[Trae MCP] Parse error:", error instanceof Error ? error.message : String(error));
            }
        }
    });
    process.stdin.on("end", () => {
        stopHeartbeat();
        console.error("[Trae MCP] stdin closed");
    });
}
main().catch((error) => {
    console.error(`[Trae MCP] Fatal error:`, error instanceof Error ? error.message : String(error));
    process.exit(1);
});
export {};
