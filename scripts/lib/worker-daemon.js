import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync, execSync } from "node:child_process";
import { handleDispatcherHttpRequest } from "./dispatcher-server.js";
import { prepareTaskWorktree, removeTaskWorktree, safeTaskDirName } from "./task-worktree.js";
import { formatLocalTimestamp } from "./time.js";
import { buildWorkerEnv, assertSafeBranchName, shouldCreatePullRequest, shouldRemoveWorktreeOnExit } from "./worker-daemon-helpers.js";
function resolveDispatcherDist() {
    const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
    const distPath = path.join(repoRoot, "apps/dispatcher/dist/modules/server/runtime-glue-dispatcher-client.js");
    return { repoRoot, distPath };
}
function ensureDispatcherDist() {
    const { repoRoot, distPath } = resolveDispatcherDist();
    if (fs.existsSync(distPath)) {
        return;
    }
    execSync("pnpm --dir apps/dispatcher run build", {
        cwd: repoRoot,
        stdio: "inherit",
    });
}
async function bootstrapDispatcherBridge() {
    const { repoRoot, distPath } = resolveDispatcherDist();
    if (!fs.existsSync(distPath)) {
        ensureDispatcherDist();
    }
    const distDir = path.join(repoRoot, "apps/dispatcher/dist");
    return import(path.join(distDir, "modules/server/runtime-glue-dispatcher-client.js"));
}
function nowIso() {
    return formatLocalTimestamp();
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function reportWorkerEventBestEffort(client, workerId, event) {
    if (typeof client.reportEvent !== "function") {
        return;
    }
    try {
        await client.reportEvent(workerId, {
            type: event.type,
            taskId: event.taskId,
            payload: event.payload,
            at: event.at ?? nowIso(),
        });
    }
    catch (error) {
        console.warn("failed to report worker event", {
            workerId,
            taskId: event.taskId,
            eventType: event.type,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}
function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
function writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
function ensureSuccess(result, message) {
    if ((result.status ?? 1) !== 0) {
        throw new Error(result.stderr || result.stdout || message);
    }
}
function runGit(args, cwd) {
    const result = spawnSync("git", args, {
        cwd,
        encoding: "utf8",
    });
    return {
        status: result.status ?? 1,
        stdout: (result.stdout || "").trim(),
        stderr: (result.stderr || "").trim(),
    };
}
function buildWorkerFailureBlocker(kind, code, message, details) {
    return {
        kind,
        code,
        message,
        ...(details && Object.keys(details).length > 0 ? { details } : {}),
    };
}
function classifyWorkerDaemonFailure(error) {
    const message = error instanceof Error ? error.message : String(error);
    const lowerMessage = message.toLowerCase();
    if (/refusing to push to default branch|branchname not allowed by forgeflow_allowed_push_prefixes/.test(lowerMessage)) {
        return {
            failureType: "preflight",
            blocker: buildWorkerFailureBlocker("preflight", "branch_protection_hit", message),
        };
    }
    if (/existing worktree already present|already checked out|failed to create worktree|failed to fetch origin|default branch ref|invalid git branch ref|invalid branchname/.test(lowerMessage)) {
        return {
            failureType: "preflight",
            blocker: buildWorkerFailureBlocker("preflight", "workspace_prepare_failed", message),
        };
    }
    if (/operation not permitted|permission denied|sandbox|forbidden|not allowed|blocked by environment/.test(lowerMessage)) {
        return {
            failureType: "preflight",
            blocker: buildWorkerFailureBlocker("preflight", "environment_blocked", message),
        };
    }
    if (/vitest|jest|pnpm test|typecheck|verification/.test(lowerMessage)) {
        return {
            failureType: "verification",
            blocker: buildWorkerFailureBlocker("verification", "verification_failed", message),
        };
    }
    if (/submitresult failed after|failed to push changes|push failed|push failure|failed to create pull request|pr create failed|dispatcher unavailable/.test(lowerMessage)) {
        return {
            failureType: "execution",
            blocker: buildWorkerFailureBlocker("execution", "delivery_failed", message),
        };
    }
    return {
        failureType: "execution",
        blocker: buildWorkerFailureBlocker("execution", "execution_failed", message),
    };
}
function buildWorkerFailureEvidence(error) {
    const classified = classifyWorkerDaemonFailure(error);
    const message = error instanceof Error ? error.message : String(error);
    return {
        failureType: classified.failureType,
        failureSummary: message,
        blockers: [classified.blocker],
        findings: [],
    };
}
function materializeAssignmentPackage(worktreeDir, payload) {
    const assignmentDir = path.join(worktreeDir, ".orchestrator", "assignments", safeTaskDirName(payload.assignment.taskId));
    writeJson(path.join(assignmentDir, "assignment.json"), payload.assignment);
    fs.writeFileSync(path.join(assignmentDir, "worker-prompt.md"), payload.workerPrompt || "");
    fs.writeFileSync(path.join(assignmentDir, "context.md"), payload.contextMarkdown || "");
    return assignmentDir;
}
function collectChangedFiles(repoDir) {
    const result = runGit(["status", "--short"], repoDir);
    if ((result.status ?? 1) !== 0) {
        return [];
    }
    return (result.stdout ?? "")
        .split(/\r?\n/)
        .map((line) => line.trim().replace(/^[A-Z?]{1,2}\s+/, ""))
        .filter(Boolean)
        .filter((line) => !line.startsWith(".orchestrator/"))
        .filter((line) => !line.startsWith("node_modules"));
}
function maybeCommitAndPush(worktreeDir, payload, changedFiles) {
    if (changedFiles.length === 0) {
        return;
    }
    const addResult = runGit(["add", ...changedFiles], worktreeDir);
    ensureSuccess(addResult, `failed to stage changes for ${payload.assignment.taskId}`);
    const commitResult = runGit([
        "commit",
        "-m",
        `feat(${payload.assignment.taskId}): ${payload.task.title}`,
    ], worktreeDir);
    ensureSuccess(commitResult, `failed to commit changes for ${payload.assignment.taskId}`);
    const pushResult = runGit([
        "push",
        "-u",
        "origin",
        payload.assignment.branchName,
    ], worktreeDir);
    ensureSuccess(pushResult, `failed to push changes for ${payload.assignment.taskId}`);
}
async function maybeCreatePullRequest(payload, changedFiles) {
    if (!shouldCreatePullRequest() || !process.env.GITHUB_TOKEN || changedFiles.length === 0) {
        return null;
    }
    const response = await fetch(`https://api.github.com/repos/${payload.task.repo}/pulls`, {
        method: "POST",
        headers: {
            authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
            "content-type": "application/json",
            accept: "application/vnd.github+json",
            "user-agent": "forgeflow-worker-daemon",
        },
        body: JSON.stringify({
            title: payload.task.title,
            head: payload.assignment.branchName,
            base: payload.assignment.defaultBranch,
            body: [
                `Task: ${payload.task.id}`,
                "",
                "Changed Files:",
                ...changedFiles.map((item) => `- ${item}`),
            ].join("\n"),
        }),
    });
    const text = await response.text();
    const json = text ? JSON.parse(text) : {};
    if (!response.ok) {
        const message = json.message
            || json.error
            || text
            || `failed to create pull request for ${payload.assignment.taskId}`;
        throw new Error(message);
    }
    return {
        number: json.number || 0,
        url: json.html_url || "",
        headBranch: payload.assignment.branchName,
        baseBranch: payload.assignment.defaultBranch,
    };
}
function buildDryRunWorkerResult(payload, outputDir, generatedAt) {
    const workerResult = {
        taskId: payload.assignment.taskId,
        workerId: "",
        provider: payload.assignment.pool,
        pool: payload.assignment.pool,
        branchName: payload.assignment.branchName,
        repo: payload.assignment.repo,
        defaultBranch: payload.assignment.defaultBranch,
        mode: "run",
        output: "dry-run worker execution completed",
        generatedAt,
        verification: {
            allPassed: true,
            commands: Object.values(payload.assignment.commands ?? {}).map((command) => ({
                command,
                exitCode: 0,
                output: "dry-run ok",
            })),
        },
    };
    writeJson(path.join(outputDir, "worker-result.json"), workerResult);
    writeJson(path.join(outputDir, "worker-verification.json"), workerResult.verification);
    fs.writeFileSync(path.join(outputDir, "worker-output.raw.txt"), "dry-run worker execution completed\n");
    return workerResult;
}
function runWorkerAssignmentScript(repoRoot, assignmentDir, worktreeDir, outputDir) {
    return new Promise((resolve, reject) => {
        const scriptPath = path.join(repoRoot, "scripts/run-worker-assignment.js");
        const proc = spawn("node", [
            scriptPath,
            "--assignment-dir",
            assignmentDir,
            "--worktree-dir",
            worktreeDir,
            "--output-dir",
            outputDir,
        ], {
            cwd: repoRoot,
            env: buildWorkerEnv(),
        });
        let stdout = "";
        let stderr = "";
        proc.stdout?.on("data", (data) => {
            stdout += data.toString();
        });
        proc.stderr?.on("data", (data) => {
            stderr += data.toString();
        });
        proc.on("close", (code) => {
            if (code === 0) {
                try {
                    const result = readJson(path.join(outputDir, "worker-result.json"));
                    resolve(result);
                }
                catch (e) {
                    reject(new Error(`failed to read worker-result.json: ${e instanceof Error ? e.message : String(e)}`));
                }
            }
            else {
                reject(new Error(`worker execution failed with code ${code}: ${stderr || stdout}`));
            }
        });
        proc.on("error", (error) => {
            reject(new Error(`worker execution error: ${error.message}`));
        });
    });
}
const HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_TIMEOUT_MS = 5_000;
const HEARTBEAT_MAX_RETRIES = 3;
const HEARTBEAT_RETRY_DELAY_MS = 1_000;
const SUBMIT_RESULT_MAX_RETRIES = 3;
const SUBMIT_RESULT_RETRY_DELAY_MS = 2_000;
function getSubmitResultMaxRetries() {
    return Number(process.env.WORKER_DAEMON_SUBMIT_RESULT_MAX_RETRIES || SUBMIT_RESULT_MAX_RETRIES);
}
function getSubmitResultRetryDelayMs() {
    return Number(process.env.WORKER_DAEMON_SUBMIT_RESULT_RETRY_DELAY_MS || SUBMIT_RESULT_RETRY_DELAY_MS);
}
function buildWorkerProtocolEnvelope(payload) {
    return {
        attemptId: payload.attemptId,
        leaseToken: payload.leaseToken,
        protocolVersion: payload.protocolVersion,
        traceId: payload.traceId,
        idempotencyKey: payload.idempotencyKey,
    };
}
async function processTaskAssignment(input) {
    const heartbeatClient = input.client;
    const taskId = input.payload.task.id;
    const workerId = input.workerId;
    let worktreeDir = null;
    let heartbeatIntervalId = null;
    const startHeartbeat = () => {
        heartbeatIntervalId = setInterval(async () => {
            try {
                await heartbeatClient.heartbeat(workerId, { at: nowIso() });
            }
            catch (error) {
                console.error(`heartbeat failed for task ${taskId}:`, error instanceof Error ? error.message : String(error));
            }
        }, HEARTBEAT_INTERVAL_MS);
    };
    const stopHeartbeat = () => {
        if (heartbeatIntervalId) {
            clearInterval(heartbeatIntervalId);
            heartbeatIntervalId = null;
        }
    };
    try {
        await input.client.startTask(input.workerId, {
            taskId: input.payload.task.id,
            ...buildWorkerProtocolEnvelope(input.payload),
            at: input.at ?? nowIso(),
        });
        startHeartbeat();
        assertSafeBranchName(input.repoDir, input.payload.assignment.branchName, input.payload.assignment.defaultBranch);
        worktreeDir = prepareTaskWorktree(input.repoDir, input.payload.assignment, {
            allowReuse: true,
            resetOnReuse: true,
        });
        const assignmentDir = materializeAssignmentPackage(worktreeDir, input.payload);
        const outputDir = path.join(assignmentDir, "execution");
        fs.mkdirSync(outputDir, { recursive: true });
        await reportWorkerEventBestEffort(input.client, input.workerId, {
            type: "progress_reported",
            taskId,
            payload: { stage: "worktree_prepared", message: "worktree prepared, running worker assignment" },
        });
        const workerResult = input.dryRunExecution
            ? buildDryRunWorkerResult(input.payload, outputDir, input.at ?? nowIso())
            : await runWorkerAssignmentScript(input.repoRoot, assignmentDir, worktreeDir, outputDir);
        const changedFiles = input.dryRunExecution ? [] : collectChangedFiles(worktreeDir);
        await reportWorkerEventBestEffort(input.client, input.workerId, {
            type: "progress_reported",
            taskId,
            payload: { stage: "execution_completed", message: `worker execution completed, ${changedFiles.length} changed file(s)` },
        });
        if (!input.dryRunExecution) {
            maybeCommitAndPush(worktreeDir, input.payload, changedFiles);
        }
        const pullRequest = input.dryRunExecution ? null : await maybeCreatePullRequest(input.payload, changedFiles);
        stopHeartbeat();
        let lastError = null;
        const submitResultMaxRetries = getSubmitResultMaxRetries();
        const submitResultRetryDelayMs = getSubmitResultRetryDelayMs();
        for (let attempt = 1; attempt <= submitResultMaxRetries; attempt++) {
            try {
                await input.client.submitResult(input.workerId, {
                    ...buildWorkerProtocolEnvelope(input.payload),
                    result: workerResult,
                    changedFiles,
                    pullRequest,
                });
                lastError = null;
                break;
            }
            catch (error) {
                lastError = error instanceof Error ? error.message : String(error);
                console.error(`submitResult attempt ${attempt}/${submitResultMaxRetries} failed for task ${taskId}:`, lastError);
                await reportWorkerEventBestEffort(input.client, input.workerId, {
                    type: "submit_result_retry_failed",
                    taskId,
                    payload: {
                        attempt,
                        maxRetries: submitResultMaxRetries,
                        error: lastError,
                    },
                });
                if (attempt < submitResultMaxRetries) {
                    await sleep(submitResultRetryDelayMs);
                }
            }
        }
        if (lastError) {
            console.error(`all submitResult retries failed for task ${taskId}, worker may need manual recovery:`, lastError);
            await reportWorkerEventBestEffort(input.client, input.workerId, {
                type: "delivery_failed",
                taskId,
                payload: {
                    stage: "submit_result",
                    error: lastError,
                    failureCode: "delivery_failed",
                },
            });
            throw new Error(`submitResult failed after ${submitResultMaxRetries} attempts: ${lastError}`);
        }
        return {
            status: "completed",
            taskId: input.payload.task.id,
            workerId: input.workerId,
            worktreeDir,
            outputDir,
            changedFiles,
            pullRequest,
        };
    }
    catch (error) {
        stopHeartbeat();
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`task execution failed for ${taskId}:`, errorMessage);
        try {
            const failedResult = {
                taskId: input.payload.task.id,
                workerId: input.workerId,
                provider: input.payload.assignment.pool,
                pool: input.payload.assignment.pool,
                branchName: input.payload.assignment.branchName,
                repo: input.payload.assignment.repo,
                defaultBranch: input.payload.assignment.defaultBranch,
                mode: "run",
                output: `ERROR: ${errorMessage}`,
                generatedAt: nowIso(),
                verification: {
                    allPassed: false,
                    commands: [],
                },
                evidence: buildWorkerFailureEvidence(errorMessage),
            };
            const failedOutputDir = path.join(input.repoDir, ".worktrees", "failed", safeTaskDirName(taskId));
            fs.mkdirSync(failedOutputDir, { recursive: true });
            writeJson(path.join(failedOutputDir, "worker-result.json"), failedResult);
            writeJson(path.join(failedOutputDir, "worker-verification.json"), failedResult.verification);
            fs.writeFileSync(path.join(failedOutputDir, "worker-output.raw.txt"), `ERROR: ${errorMessage}\n`);
            const submitResultMaxRetries = getSubmitResultMaxRetries();
            const submitResultRetryDelayMs = getSubmitResultRetryDelayMs();
            for (let attempt = 1; attempt <= submitResultMaxRetries; attempt++) {
                try {
                await input.client.submitResult(input.workerId, {
                    ...buildWorkerProtocolEnvelope(input.payload),
                    result: failedResult,
                    changedFiles: [],
                    pullRequest: null,
                    });
                    console.error(`submitted failed result for ${taskId} after catch`);
                    break;
                }
                catch (submitError) {
                    console.error(`submitResult in catch attempt ${attempt} failed:`, submitError instanceof Error ? submitError.message : String(submitError));
                    await reportWorkerEventBestEffort(input.client, input.workerId, {
                        type: "submit_result_retry_failed",
                        taskId,
                        payload: {
                            attempt,
                            maxRetries: submitResultMaxRetries,
                            error: submitError instanceof Error ? submitError.message : String(submitError),
                            fallback: true,
                        },
                    });
                    if (attempt < submitResultMaxRetries) {
                        await sleep(submitResultRetryDelayMs);
                    }
                }
            }
        }
        catch (fallbackError) {
            console.error(`failed to submit error result for ${taskId}:`, fallbackError instanceof Error ? fallbackError.message : String(fallbackError));
            await reportWorkerEventBestEffort(input.client, input.workerId, {
                type: "delivery_failed",
                taskId,
                payload: {
                    stage: "failed_result_fallback",
                    error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
                    failureCode: "delivery_failed",
                },
            });
        }
        throw error;
    }
    finally {
        if (worktreeDir && shouldRemoveWorktreeOnExit()) {
            try {
                removeTaskWorktree(input.repoDir, taskId);
            }
            catch (cleanupError) {
                console.error(`failed to cleanup worktree for ${taskId}:`, cleanupError instanceof Error ? cleanupError.message : String(cleanupError));
                await reportWorkerEventBestEffort(input.client, input.workerId, {
                    type: "worktree_cleanup_failed",
                    taskId,
                    payload: {
                        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
                        failureCode: "cleanup_failed",
                    },
                });
            }
        }
    }
}
export function createDispatcherClient(dispatcherUrl) {
    const baseUrl = dispatcherUrl.replace(/\/$/, "");
    async function call(method, pathname, body, options = {}) {
        const url = `${baseUrl}${pathname}`;
        const timeoutMs = options.timeout ?? 10_000;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(url, {
                method,
                headers: {
                    "content-type": "application/json",
                },
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            const text = await response.text();
            const json = text ? JSON.parse(text) : {};
            if (!response.ok) {
                throw new Error(json.error || text || `dispatcher request failed: ${method} ${url} -> ${response.status}`);
            }
            return json;
        }
        catch (error) {
            clearTimeout(timeoutId);
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`dispatcher request failed: ${method} ${url} - ${errorMessage}`);
        }
    }
    async function callWithRetry(method, pathname, body, options = {}) {
        const maxRetries = options.maxRetries ?? 0;
        const retryDelayMs = options.retryDelayMs ?? 1_000;
        let lastError = null;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return await call(method, pathname, body, options);
            }
            catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                if (attempt < maxRetries) {
                    await sleep(retryDelayMs);
                }
            }
        }
        throw lastError;
    }
    return {
        registerWorker(worker) {
            return call("POST", "/api/workers/register", worker);
        },
        heartbeat(workerId, payload) {
            return callWithRetry("POST", `/api/workers/${encodeURIComponent(workerId)}/heartbeat`, payload, {
                timeout: HEARTBEAT_TIMEOUT_MS,
                maxRetries: HEARTBEAT_MAX_RETRIES,
                retryDelayMs: HEARTBEAT_RETRY_DELAY_MS,
            });
        },
        getAssignedTask(workerId) {
            return call("GET", `/api/workers/${encodeURIComponent(workerId)}/assigned-task`);
        },
        claimTask(workerId, payload = {}) {
            return call("POST", `/api/workers/${encodeURIComponent(workerId)}/claim-task`, payload);
        },
        startTask(workerId, payload) {
            return call("POST", `/api/workers/${encodeURIComponent(workerId)}/start-task`, payload);
        },
        submitResult(workerId, payload) {
            return call("POST", `/api/workers/${encodeURIComponent(workerId)}/result`, payload);
        },
        reportEvent(workerId, payload) {
            return call("POST", `/api/workers/${encodeURIComponent(workerId)}/events`, payload);
        },
    };
}
function readStateDirResponseJson(response) {
    if (response.status >= 400) {
        const error = response.json && typeof response.json === "object" && "error" in response.json
            ? String(response.json.error)
            : `dispatcher state-dir request failed: ${response.status}`;
        throw new Error(error);
    }
    return response.json;
}
export function createStateDirDispatcherClient(stateDir) {
    return {
        registerWorker(worker) {
            const response = handleDispatcherHttpRequest({
                stateDir,
                method: "POST",
                pathname: "/api/workers/register",
                body: worker,
                clientAddress: "127.0.0.1",
                internalCall: true,
            });
            return Promise.resolve(readStateDirResponseJson(response));
        },
        heartbeat(workerId, payload) {
            const response = handleDispatcherHttpRequest({
                stateDir,
                method: "POST",
                pathname: `/api/workers/${encodeURIComponent(workerId)}/heartbeat`,
                body: payload,
                clientAddress: "127.0.0.1",
                internalCall: true,
            });
            return Promise.resolve(readStateDirResponseJson(response));
        },
        getAssignedTask(workerId) {
            const response = handleDispatcherHttpRequest({
                stateDir,
                method: "GET",
                pathname: `/api/workers/${encodeURIComponent(workerId)}/assigned-task`,
                clientAddress: "127.0.0.1",
                internalCall: true,
            });
            return Promise.resolve(readStateDirResponseJson(response));
        },
        claimTask(workerId, payload = {}) {
            const response = handleDispatcherHttpRequest({
                stateDir,
                method: "POST",
                pathname: `/api/workers/${encodeURIComponent(workerId)}/claim-task`,
                body: payload,
                clientAddress: "127.0.0.1",
                internalCall: true,
            });
            return Promise.resolve(readStateDirResponseJson(response));
        },
        startTask(workerId, payload) {
            const response = handleDispatcherHttpRequest({
                stateDir,
                method: "POST",
                pathname: `/api/workers/${encodeURIComponent(workerId)}/start-task`,
                body: payload,
                clientAddress: "127.0.0.1",
                internalCall: true,
            });
            return Promise.resolve(readStateDirResponseJson(response));
        },
        submitResult(workerId, payload) {
            const response = handleDispatcherHttpRequest({
                stateDir,
                method: "POST",
                pathname: `/api/workers/${encodeURIComponent(workerId)}/result`,
                body: payload,
                clientAddress: "127.0.0.1",
                internalCall: true,
            });
            return Promise.resolve(readStateDirResponseJson(response));
        },
        reportEvent(workerId, payload) {
            const response = handleDispatcherHttpRequest({
                stateDir,
                method: "POST",
                pathname: `/api/workers/${encodeURIComponent(workerId)}/events`,
                body: payload,
                clientAddress: "127.0.0.1",
                internalCall: true,
            });
            return Promise.resolve(readStateDirResponseJson(response));
        },
    };
}
export async function runWorkerDaemonCycle(input) {
    const client = input.client ?? createDispatcherClient(input.dispatcherUrl || "");
    const at = input.at ?? nowIso();
    await client.registerWorker({
        workerId: input.workerId,
        pool: input.pool,
        hostname: input.hostname ?? os.hostname(),
        labels: input.labels ?? [],
        repoDir: input.repoDir,
        at,
    });
    await client.heartbeat(input.workerId, { at });
    const assigned = await client.claimTask(input.workerId, { at });
    if (!assigned || !assigned.assignment || !assigned.task) {
        return {
            status: "idle",
            workerId: input.workerId,
        };
    }
    return processTaskAssignment({
        client,
        repoRoot: input.repoRoot ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), "../.."),
        workerId: input.workerId,
        repoDir: input.repoDir,
        payload: {
            assignment: assigned.assignment,
            task: assigned.task,
            ...buildWorkerProtocolEnvelope(assigned),
        },
        dryRunExecution: Boolean(input.dryRunExecution),
        at,
    });
}
export async function runWorkerDaemon(input) {
    while (true) {
        const summary = await runWorkerDaemonCycle(input);
        if (input.once) {
            return summary;
        }
        await sleep(input.pollIntervalMs ?? 5000);
    }
}
