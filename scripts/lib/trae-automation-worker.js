import fs from "node:fs";
import path from "node:path";
import { prepareTaskWorktree, safeTaskDirName } from "./task-worktree.js";
import { checkArtifactReviewability } from "./trae-automation-artifact-checks.js";
const DEFAULT_DISPATCHER_URL = "http://127.0.0.1:8787";
const DEFAULT_AUTOMATION_URL = "http://127.0.0.1:8790";
const DEFAULT_POLL_INTERVAL_MS = Number(process.env.TRAE_AUTOMATION_POLL_INTERVAL_MS || 5000);
const DEFAULT_ERROR_BACKOFF_MS = Number(process.env.TRAE_AUTOMATION_ERROR_BACKOFF_MS || 5000);
const MAX_ERROR_BACKOFF_MS = Number(process.env.TRAE_AUTOMATION_MAX_ERROR_BACKOFF_MS || 30000);
const DEFAULT_DISPATCHER_REQUEST_TIMEOUT_MS = Number(process.env.TRAE_AUTOMATION_DISPATCHER_TIMEOUT_MS || 30000);
const DEFAULT_READINESS_TIMEOUT_MS = Number(process.env.TRAE_AUTOMATION_READY_TIMEOUT_MS || 30000);
const DEFAULT_READINESS_RETRY_MS = Number(process.env.TRAE_AUTOMATION_READY_RETRY_MS || 1000);
const DEFAULT_CHAT_RESPONSE_TIMEOUT_MS = Number(process.env.TRAE_AUTOMATION_CHAT_TIMEOUT_MS || 600000);
const DEFAULT_CHAT_REQUEST_TIMEOUT_BUFFER_MS = Number(process.env.TRAE_AUTOMATION_CHAT_REQUEST_TIMEOUT_BUFFER_MS || 30000);
const HIGH_HEARTBEAT_INTERVAL_MS = 10_000;
const IDLE_HEARTBEAT_INTERVAL_MS = 10_000;
const DEFAULT_SOFT_CHAT_TIMEOUT_MS = Number(process.env.TRAE_AUTOMATION_SOFT_CHAT_TIMEOUT_MS || 30 * 60 * 1000);
const DEFAULT_HARD_CHAT_TIMEOUT_MS = Number(process.env.TRAE_AUTOMATION_HARD_CHAT_TIMEOUT_MS || 45 * 60 * 1000);
const MAX_HARD_CHAT_TIMEOUT_MS = 60 * 60 * 1000;
const DEFAULT_SESSION_POLL_INTERVAL_MS = Number(process.env.TRAE_AUTOMATION_SESSION_POLL_INTERVAL_MS || 10000);
export function createJsonHttpClient(baseUrl, options = {}) {
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    if (typeof fetchImpl !== "function") {
        throw new Error("global fetch is required");
    }
    const base = String(baseUrl || "").replace(/\/$/, "");
    async function request(path, init = {}) {
        const controller = new AbortController();
        const timeoutMs = Number(init.timeoutMs || 10000);
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetchImpl(`${base}${path}`, {
                method: init.method || "GET",
                headers: init.body ? { "content-type": "application/json" } : undefined,
                body: init.body ? JSON.stringify(init.body) : undefined,
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            const text = await response.text();
            const json = text ? JSON.parse(text) : {};
            if (!response.ok) {
                throw new Error(json.message || json.error || `HTTP ${response.status}`);
            }
            return json;
        }
        catch (error) {
            clearTimeout(timeoutId);
            if (error instanceof Error && error.name === "AbortError") {
                throw new Error(`request timeout: ${path}`);
            }
            throw error instanceof Error ? error : new Error(String(error));
        }
    }
    return { request };
}
export function createDispatcherClient(baseUrl = DEFAULT_DISPATCHER_URL, options = {}) {
    const http = createJsonHttpClient(baseUrl, options);
    const requestTimeoutMs = Number(options.requestTimeoutMs || DEFAULT_DISPATCHER_REQUEST_TIMEOUT_MS);
    return {
        async register(worker) {
            return http.request("/api/trae/register", {
                method: "POST",
                body: {
                    worker_id: worker.workerId,
                    pool: worker.pool,
                    repo_dir: worker.repoDir,
                    labels: worker.labels || [],
                },
                timeoutMs: requestTimeoutMs,
            });
        },
        async fetchTask(workerId, repoDir) {
            return http.request("/api/trae/fetch-task", {
                method: "POST",
                body: { worker_id: workerId, repo_dir: repoDir },
                timeoutMs: requestTimeoutMs,
            });
        },
        async startTask(workerId, taskId) {
            return http.request("/api/trae/start-task", {
                method: "POST",
                body: { worker_id: workerId, task_id: taskId },
                timeoutMs: requestTimeoutMs,
            });
        },
        async reportProgress(taskId, message, workerId) {
            return http.request("/api/trae/report-progress", {
                method: "POST",
                body: { task_id: taskId, message, worker_id: workerId },
                timeoutMs: requestTimeoutMs,
            });
        },
        async submitResult(input) {
            return http.request("/api/trae/submit-result", {
                method: "POST",
                body: {
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
                },
                timeoutMs: requestTimeoutMs,
            });
        },
        async heartbeat(workerId) {
            return http.request("/api/trae/heartbeat", {
                method: "POST",
                body: { worker_id: workerId },
                timeoutMs: requestTimeoutMs,
            });
        },
    };
}
export function createAutomationGatewayClient(baseUrl = DEFAULT_AUTOMATION_URL, options = {}) {
    const http = createJsonHttpClient(baseUrl, options);
    function buildReadyPath(input = {}) {
        const discovery = input.discovery || null;
        if (!discovery) {
            return "/ready";
        }
        const params = new URLSearchParams();
        if (Array.isArray(discovery.titleContains) && discovery.titleContains.length > 0) {
            params.set("title_contains", discovery.titleContains.join(","));
        }
        if (Array.isArray(discovery.urlContains) && discovery.urlContains.length > 0) {
            params.set("url_contains", discovery.urlContains.join(","));
        }
        const query = params.toString();
        return query ? `/ready?${query}` : "/ready";
    }
    return {
        async ready(input = {}) {
            return http.request(buildReadyPath(input));
        },
        async prepareSession(input = {}) {
            return http.request("/v1/sessions/prepare", {
                method: "POST",
                body: {
                    chatMode: input.chatMode || "new_chat",
                    discovery: input.discovery || null,
                },
            });
        },
        async getSession(sessionId) {
            return http.request(`/v1/sessions/${sessionId}`);
        },
        async sendChat(input) {
            const responseTimeoutMs = Number(input.responseTimeoutMs || DEFAULT_CHAT_RESPONSE_TIMEOUT_MS);
            return http.request("/v1/chat", {
                method: "POST",
                body: {
                    content: input.content,
                    sessionId: input.sessionId || null,
                    prepare: input.prepare !== false,
                    discovery: input.discovery || null,
                    chatMode: input.chatMode || null,
                    responseRequiredPrefix: input.responseRequiredPrefix || null,
                    responseTimeoutMs,
                },
                timeoutMs: Number(input.timeoutMs || responseTimeoutMs + DEFAULT_CHAT_REQUEST_TIMEOUT_BUFFER_MS),
            });
        },
    };
}
export function buildFinalReportTemplate() {
    return [
        "## 任务完成",
        "- 结果: 成功 / 失败",
        "- 任务ID: <task_id>",
        "- 修改文件: <files_changed> (无则写\"无\")",
        "- 测试结果: <test_output> (无则写\"无\")",
        "- 风险: <risks> (无则写\"无\")",
        "- GitHub 证据:",
        "  - branch: <branch_name> (无则写\"无\")",
        "  - commit: <commit_sha> (无则写\"无\")",
        "  - push: <push_status> (无则写\"无\")",
        "  - push_error: <push_error> (无则写\"无\")",
        "  - PR: <pr_number> (无则写\"无\")",
        "  - PR URL: <pr_url> (无则写\"无\")",
        "- 备注: <阻塞/后续动作；无则写\"无\">",
    ].join("\n");
}
export function buildAutomationPrompt(task) {
    const scope = Array.isArray(task.scope) && task.scope.length > 0 ? task.scope.join(", ") : "all";
    const constraints = Array.isArray(task.constraints) && task.constraints.length > 0
        ? task.constraints.map((item) => `- ${item}`).join("\n")
        : "- none";
    const acceptance = Array.isArray(task.acceptance) && task.acceptance.length > 0
        ? task.acceptance.map((item) => `- ${item}`).join("\n")
        : "- none";
    return [
        "你正在以 ForgeFlow 的无人值守 Trae 执行 worker 身份工作。",
        "请直接执行任务，不要解释流程，不要反问。",
        "",
        `任务ID: ${task.task_id}`,
        `仓库: ${task.repo || "unknown"}`,
        `分支: ${task.branch || "unknown"}`,
        `目标: ${task.goal || task.prompt || "未提供"}`,
        `允许范围: ${scope}`,
        `worktree_dir: ${task.worktree_dir || "无"}`,
        `assignment_dir: ${task.assignment_dir || "无"}`,
        "",
        "约束：",
        constraints,
        "",
        "验收命令：",
        acceptance,
        "",
        "任务说明：",
        task.prompt || task.goal || "",
        "",
        "完成要求：",
        "- 只在允许范围内修改文件",
        "- 运行验收命令",
        "- 如果可以，提交并推送变更",
        "- 最终必须严格按下面模板回复",
        "",
        buildFinalReportTemplate(),
    ].join("\n");
}
function normalizeFieldValue(value) {
    const trimmed = String(value || "").trim();
    if (!trimmed || trimmed === "无") {
        return "";
    }
    return trimmed;
}
function splitListValue(value) {
    const normalized = normalizeFieldValue(value);
    if (!normalized) {
        return [];
    }
    return normalized
        .split(/[，,、;\n]/)
        .map((item) => item.trim())
        .filter(Boolean);
}
export function normalizePushStatus(value) {
    const normalized = normalizeFieldValue(value).toLowerCase();
    if (!normalized) {
        return "not_attempted";
    }
    if (normalized === "success" || normalized === "成功") {
        return "success";
    }
    if (normalized === "failed" || normalized === "failure" || normalized === "失败") {
        return "failed";
    }
    return "not_attempted";
}
function basenameFromPath(value) {
    const normalized = String(value || "").trim().replace(/[\\/]+$/, "");
    if (!normalized) {
        return "";
    }
    const parts = normalized.split(/[\\/]/).filter(Boolean);
    return parts.at(-1) || "";
}
export function materializeTaskWorkspace(task, repoDir) {
    const taskId = String(task?.task_id || "").trim();
    if (!taskId) {
        throw new Error("task_id is required to materialize task workspace");
    }
    const resolvedRepoDir = String(repoDir || "").trim();
    if (!resolvedRepoDir) {
        throw new Error("repoDir is required to materialize task workspace");
    }
    const worktreeDir = prepareTaskWorktree(resolvedRepoDir, {
        taskId,
        branchName: task.branch,
        defaultBranch: task.default_branch || task.defaultBranch,
    }, {
        allowReuse: true,
    });
    const assignmentDir = path.join(worktreeDir, ".orchestrator", "assignments", safeTaskDirName(taskId));
    fs.mkdirSync(assignmentDir, { recursive: true });
    const assignmentPayload = {
        taskId,
        repo: task.repo || "",
        branchName: task.branch || "",
        defaultBranch: task.default_branch || task.defaultBranch || "",
        allowedPaths: Array.isArray(task.scope) ? task.scope : [],
        acceptance: Array.isArray(task.acceptance) ? task.acceptance : [],
        constraints: Array.isArray(task.constraints) ? task.constraints : [],
        goal: task.goal || "",
    };
    fs.writeFileSync(path.join(assignmentDir, "assignment.json"), JSON.stringify(assignmentPayload, null, 2));
    fs.writeFileSync(path.join(assignmentDir, "worker-prompt.md"), task.prompt || "");
    fs.writeFileSync(path.join(assignmentDir, "context.md"), task.prompt || task.goal || "");
    task.worktree_dir = worktreeDir;
    task.assignment_dir = assignmentDir;
    return { worktree_dir: worktreeDir, assignment_dir: assignmentDir };
}
export function deriveTaskDiscoveryHints(task = undefined, repoDir = "") {
    const titleContains = [];
    const seen = new Set();
    const candidates = [
        task?.worktree_dir,
        task?.assignment_dir,
        repoDir,
    ];
    for (const candidate of candidates) {
        const hint = basenameFromPath(candidate || "");
        if (!hint) {
            continue;
        }
        const key = hint.toLowerCase();
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        titleContains.push(hint);
    }
    return titleContains.length > 0 ? { titleContains } : null;
}
export function deriveRegisterDiscoveryHints(repoDir = "") {
    const hint = basenameFromPath(repoDir);
    return hint ? { titleContains: [hint] } : null;
}
export function isAutomationGatewayReady(readiness) {
    const r = readiness;
    return r?.data?.ready === true || r?.ready === true;
}
function isTimeoutError(error) {
    const message = error instanceof Error ? error.message : String(error);
    return /timeout|Timed out/i.test(message);
}
function isTemplateEchoError(error) {
    const message = error instanceof Error ? error.message : String(error);
    return /template echo/i.test(message);
}
function shouldAttemptSessionRecovery(error) {
    return isTimeoutError(error) || isTemplateEchoError(error);
}
function createMissingSessionIdRecoveryError(error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Error(`Session recovery unavailable: missing sessionId from prepareSession. Original chat error: ${message}`);
}
export async function waitForAutomationGatewayReady(options) {
    const automationClient = options.automationClient;
    const repoDir = options.repoDir || "";
    const sleepImpl = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const now = typeof options.now === "function" ? options.now : Date.now;
    const logger = options.logger || console;
    const timeoutMs = Number(options.timeoutMs || DEFAULT_READINESS_TIMEOUT_MS);
    const retryIntervalMs = Number(options.retryIntervalMs || DEFAULT_READINESS_RETRY_MS);
    const discovery = options.discovery || deriveRegisterDiscoveryHints(repoDir);
    if (!automationClient || typeof automationClient.ready !== "function") {
        throw new Error("automationClient.ready is required");
    }
    const startedAt = now();
    let attempt = 0;
    let lastReadiness = options.initialReadiness;
    let lastError = null;
    while (now() - startedAt < timeoutMs) {
        attempt += 1;
        try {
            const readiness = attempt === 1 && lastReadiness !== undefined
                ? lastReadiness
                : await automationClient.ready({ discovery: discovery || undefined });
            lastReadiness = readiness;
            if (isAutomationGatewayReady(readiness)) {
                return readiness;
            }
            const code = readiness?.error?.code || "AUTOMATION_NOT_READY";
            logger?.warn?.(`[trae-automation-worker] gateway readiness attempt ${attempt} not ready: ${code}`);
        }
        catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            logger?.warn?.(`[trae-automation-worker] gateway readiness attempt ${attempt} failed: ${lastError.message}`);
        }
        if (now() - startedAt + retryIntervalMs >= timeoutMs) {
            break;
        }
        await sleepImpl(retryIntervalMs);
    }
    if (lastError) {
        throw new Error(`Trae automation gateway is not ready: ${lastError.message}`);
    }
    if (lastReadiness && typeof lastReadiness === "object" && "error" in lastReadiness && lastReadiness.error?.code) {
        throw new Error(`Trae automation gateway is not ready: ${lastReadiness.error.code}`);
    }
    throw new Error("Trae automation gateway is not ready");
}
export function parseFinalReport(text) {
    const lines = String(text || "").split(/\r?\n/);
    const fields = {
        result: "",
        taskId: "",
        filesChanged: "",
        testOutput: "",
        risks: "",
        notes: "",
        branch: "",
        commit: "",
        push: "",
        pushError: "",
        pr: "",
        prUrl: "",
    };
    let section = "";
    for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        if (!line.trim()) {
            continue;
        }
        if (line.trim() === "## 任务完成" || line.trim() === "任务完成") {
            continue;
        }
        if (line.trim() === "- GitHub 证据:" || line.trim() === "GitHub 证据:") {
            section = "github";
            continue;
        }
        const match = line.match(/^\s*(?:-\s*)?([^:]+):\s*(.*)$/);
        if (!match) {
            if (section === "test" && fields.testOutput) {
                fields.testOutput += `\n${line.trim()}`;
            }
            continue;
        }
        const key = match[1].trim();
        const value = match[2].trim();
        switch (key) {
            case "结果":
                fields.result = value;
                section = "";
                break;
            case "任务ID":
                fields.taskId = value;
                section = "";
                break;
            case "修改文件":
                fields.filesChanged = value;
                section = "";
                break;
            case "测试结果":
                fields.testOutput = value;
                section = "test";
                break;
            case "风险":
                fields.risks = value;
                section = "";
                break;
            case "备注":
                fields.notes = value;
                section = "";
                break;
            case "branch":
                fields.branch = value;
                break;
            case "commit":
                fields.commit = value;
                break;
            case "push":
                fields.push = value;
                break;
            case "push_error":
                fields.pushError = value;
                break;
            case "PR":
                fields.pr = value;
                break;
            case "PR URL":
                fields.prUrl = value;
                break;
            default:
                break;
        }
    }
    if (!fields.result || !fields.taskId) {
        throw new Error("final report did not match the required template");
    }
    return {
        result: fields.result,
        taskId: fields.taskId,
        filesChanged: splitListValue(fields.filesChanged),
        testOutput: normalizeFieldValue(fields.testOutput),
        risks: splitListValue(fields.risks),
        notes: normalizeFieldValue(fields.notes),
        github: {
            branchName: normalizeFieldValue(fields.branch) || null,
            commitSha: normalizeFieldValue(fields.commit) || null,
            pushStatus: normalizePushStatus(fields.push),
            pushError: normalizeFieldValue(fields.pushError) || null,
            prNumber: normalizeFieldValue(fields.pr) ? Number(normalizeFieldValue(fields.pr)) : null,
            prUrl: normalizeFieldValue(fields.prUrl) || null,
        },
    };
}
function createHeartbeatController(dispatcherClient, workerId, logger, options = {}) {
    const timers = {
        interval: null,
        mode: "idle",
    };
    const setIntervalImpl = options.setIntervalImpl || setInterval;
    const clearIntervalImpl = options.clearIntervalImpl || clearInterval;
    function start(mode = "high") {
        if (timers.interval) {
            clearIntervalImpl(timers.interval);
        }
        timers.mode = mode;
        const intervalMs = mode === "high" ? HIGH_HEARTBEAT_INTERVAL_MS : IDLE_HEARTBEAT_INTERVAL_MS;
        timers.interval = setIntervalImpl(async () => {
            try {
                await dispatcherClient.heartbeat(workerId);
            }
            catch (error) {
                logger?.warn?.(`[trae-automation-worker] heartbeat failed: ${error.message}`);
            }
        }, intervalMs);
    }
    function promoteToIdle() {
        if (timers.mode !== "idle") {
            start("idle");
        }
    }
    function stop() {
        if (timers.interval) {
            clearIntervalImpl(timers.interval);
            timers.interval = null;
        }
    }
    return { start, promoteToIdle, stop };
}
export function createTraeAutomationWorkerRuntime(options) {
    const dispatcherClient = options.dispatcherClient;
    const automationClient = options.automationClient;
    const workerId = options.workerId;
    const repoDir = options.repoDir;
    const logger = options.logger || console;
    const sleepImpl = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const pollIntervalMs = Number(options.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS);
    const errorBackoffMs = Number(options.errorBackoffMs || DEFAULT_ERROR_BACKOFF_MS);
    const maxErrorBackoffMs = Number(options.maxErrorBackoffMs || MAX_ERROR_BACKOFF_MS);
    const heartbeat = createHeartbeatController(dispatcherClient, workerId, logger, options);
    if (!dispatcherClient || !automationClient || !workerId || !repoDir) {
        throw new Error("dispatcherClient, automationClient, workerId, and repoDir are required");
    }
    async function submitParsedResult(task, parsed) {
        const status = parsed.result === "成功" ? "review_ready" : "failed";
        await dispatcherClient.submitResult({
            taskId: task.task_id,
            status,
            summary: parsed.notes || parsed.result,
            testOutput: parsed.testOutput || "",
            risks: parsed.risks,
            filesChanged: parsed.filesChanged,
            github: parsed.github,
        });
        heartbeat.promoteToIdle();
        return status;
    }
    async function submitFailure(task, error, rawOutput = "") {
        await dispatcherClient.submitResult({
            taskId: task.task_id,
            status: "failed",
            summary: error.message,
            testOutput: rawOutput,
            risks: [],
            filesChanged: [],
            github: {
                branchName: null,
                commitSha: null,
                pushStatus: "not_attempted",
                pushError: null,
                prNumber: null,
                prUrl: null,
            },
        });
        heartbeat.promoteToIdle();
    }
    async function pollSessionStatus(sessionId, timeoutMs, pollIntervalMs) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            try {
                const session = await automationClient.getSession(sessionId);
                const status = session?.data?.status || session?.status;
                if (status === "completed" || status === "failed" || status === "interrupted") {
                    const data = session?.data;
                    if (data) {
                        return { status: data.status || status, error: data.error };
                    }
                    return { status: status || "unknown", error: session?.error };
                }
                await sleepImpl(pollIntervalMs);
            }
            catch {
                await sleepImpl(pollIntervalMs);
            }
        }
        return { status: "running" };
    }
    return {
        async register() {
            await dispatcherClient.register({
                workerId,
                pool: "trae",
                repoDir,
                labels: ["automation-gateway"],
            });
            heartbeat.start("idle");
            return automationClient.ready({
                discovery: deriveRegisterDiscoveryHints(repoDir) || undefined,
            });
        },
        async runOnce() {
            const fetched = await dispatcherClient.fetchTask(workerId, repoDir);
            if (!fetched || fetched.status === "no_task") {
                return { status: "no_task" };
            }
            const task = fetched.task;
            materializeTaskWorkspace(task, repoDir);
            await dispatcherClient.startTask(workerId, task.task_id);
            heartbeat.start("high");
            await dispatcherClient.reportProgress(task.task_id, "Trae automation worker started task", workerId);
            const prompt = buildAutomationPrompt(task);
            const discovery = deriveTaskDiscoveryHints(task, repoDir);
            let sessionId = null;
            const startedAt = Date.now();
            try {
                await dispatcherClient.reportProgress(task.task_id, "Trae automation gateway is preparing session", workerId);
                const prepareResult = await automationClient.prepareSession({
                    chatMode: task.chatMode || task.chat_mode || "new_chat",
                });
                sessionId = prepareResult?.data?.sessionId || prepareResult?.sessionId || null;
                await dispatcherClient.reportProgress(task.task_id, "Trae automation gateway is sending prompt", workerId);
                const softTimeoutMs = Math.min(DEFAULT_SOFT_CHAT_TIMEOUT_MS, DEFAULT_HARD_CHAT_TIMEOUT_MS);
                const chatTimeoutMs = softTimeoutMs + DEFAULT_CHAT_REQUEST_TIMEOUT_BUFFER_MS;
                try {
                    const response = await automationClient.sendChat({
                        content: prompt,
                        sessionId,
                        prepare: false,
                        discovery: discovery || undefined,
                        chatMode: task.chatMode || task.chat_mode || "new_chat",
                        responseRequiredPrefix: "任务完成",
                        responseTimeoutMs: softTimeoutMs,
                        timeoutMs: chatTimeoutMs,
                    });
                    const r = response;
                    const finalText = r?.data?.response?.text
                        || r?.response?.text
                        || r?.data?.result?.response?.text
                        || "";
                    const parsed = parseFinalReport(finalText);
                    const finalStatus = await submitParsedResult(task, parsed);
                    return {
                        status: finalStatus,
                        taskId: task.task_id,
                        responseText: finalText,
                    };
                }
                catch (chatError) {
                    if (!shouldAttemptSessionRecovery(chatError)) {
                        throw chatError;
                    }
                    if (!sessionId) {
                        await dispatcherClient.reportProgress(task.task_id, "Chat timeout but session id is missing; cannot poll session status", workerId);
                        throw createMissingSessionIdRecoveryError(chatError);
                    }
                    const elapsed = Date.now() - startedAt;
                    if (elapsed >= DEFAULT_HARD_CHAT_TIMEOUT_MS) {
                        throw chatError;
                    }
                    await dispatcherClient.reportProgress(task.task_id, "Chat timeout, checking session status", workerId);
                    const sessionStatus = await pollSessionStatus(sessionId, DEFAULT_HARD_CHAT_TIMEOUT_MS - elapsed, DEFAULT_SESSION_POLL_INTERVAL_MS);
                    if (sessionStatus.status === "completed") {
                        const replayResponse = await automationClient.sendChat({
                            content: prompt,
                            sessionId,
                            prepare: false,
                            discovery: discovery || undefined,
                            chatMode: task.chatMode || task.chat_mode || "new_chat",
                            responseRequiredPrefix: "任务完成",
                            responseTimeoutMs: 1000,
                            timeoutMs: 5000,
                        });
                        const r = replayResponse;
                        const finalText = r?.data?.response?.text
                            || r?.response?.text
                            || r?.data?.result?.response?.text
                            || "";
                        const parsed = parseFinalReport(finalText);
                        const finalStatus = await submitParsedResult(task, parsed);
                        return {
                            status: finalStatus,
                            taskId: task.task_id,
                            responseText: finalText,
                        };
                    }
                    else if (sessionStatus.status === "failed" || sessionStatus.status === "interrupted") {
                        throw new Error(sessionStatus.error || `Session ${sessionStatus.status}`);
                    }
                    else {
                        const artifactCheck = checkArtifactReviewability(task);
                        if (artifactCheck.reviewable) {
                            if (!artifactCheck.evidence.remoteVerified) {
                                throw new Error(`Artifact not reviewable: ${artifactCheck.evidence.remoteCheckReason}`);
                            }
                            await submitParsedResult(task, {
                                result: "成功",
                                taskId: task.task_id,
                                notes: `Recovered via artifact check: ${artifactCheck.reason}`,
                                testOutput: "",
                                risks: ["Session timeout, recovered from git artifacts"],
                                filesChanged: artifactCheck.evidence.filesChanged,
                                github: {
                                    branchName: artifactCheck.evidence.branchName,
                                    commitSha: artifactCheck.evidence.commitSha,
                                    pushStatus: "verified",
                                    pushError: null,
                                    prNumber: null,
                                    prUrl: null,
                                },
                            });
                            return {
                                status: "review_ready",
                                taskId: task.task_id,
                                responseText: `Recovered via artifact check: ${artifactCheck.reason}`,
                            };
                        }
                        throw new Error("Hard timeout exceeded");
                    }
                }
            }
            catch (error) {
                const artifactCheck = checkArtifactReviewability(task);
                if (artifactCheck.reviewable && artifactCheck.evidence.remoteVerified) {
                    await submitParsedResult(task, {
                        result: "成功",
                        taskId: task.task_id,
                        notes: `Recovered via artifact check after error: ${artifactCheck.reason}`,
                        testOutput: "",
                        risks: [`Error: ${error instanceof Error ? error.message : String(error)}`],
                        filesChanged: artifactCheck.evidence.filesChanged,
                        github: {
                            branchName: artifactCheck.evidence.branchName,
                            commitSha: artifactCheck.evidence.commitSha,
                            pushStatus: "verified",
                            pushError: null,
                            prNumber: null,
                            prUrl: null,
                        },
                    });
                    return {
                        status: "review_ready",
                        taskId: task.task_id,
                        responseText: `Recovered via artifact check: ${artifactCheck.reason}`,
                    };
                }
                await submitFailure(task, error instanceof Error ? error : new Error(String(error)));
                return {
                    status: "failed",
                    taskId: task.task_id,
                    error: error instanceof Error ? error.message : String(error),
                };
            }
        },
        async runLoop(signal) {
            let consecutiveErrors = 0;
            while (!signal?.aborted) {
                try {
                    const result = await this.runOnce();
                    consecutiveErrors = 0;
                    if (result.status === "no_task") {
                        await sleepImpl(pollIntervalMs);
                    }
                }
                catch (error) {
                    consecutiveErrors += 1;
                    const backoffMs = Math.min(maxErrorBackoffMs, errorBackoffMs * consecutiveErrors);
                    logger?.warn?.(`[trae-automation-worker] runLoop recovered from error: ${error instanceof Error ? error.message : String(error)}`);
                    if (!signal?.aborted) {
                        await sleepImpl(backoffMs);
                    }
                }
            }
        },
        stop() {
            heartbeat.stop();
        },
    };
}
export function parseArgs(argv) {
    const args = {
        dispatcherUrl: DEFAULT_DISPATCHER_URL,
        automationUrl: DEFAULT_AUTOMATION_URL,
        workerId: "trae-auto-gateway",
        repoDir: "",
        pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
        once: false,
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        const next = argv[index + 1];
        if (arg === "--dispatcher-url" && next) {
            args.dispatcherUrl = next;
            index += 1;
            continue;
        }
        if (arg === "--automation-url" && next) {
            args.automationUrl = next;
            index += 1;
            continue;
        }
        if (arg === "--worker-id" && next) {
            args.workerId = next;
            index += 1;
            continue;
        }
        if (arg === "--repo-dir" && next) {
            args.repoDir = next;
            index += 1;
            continue;
        }
        if (arg === "--poll-interval-ms" && next) {
            args.pollIntervalMs = Number(next);
            index += 1;
            continue;
        }
        if (arg === "--once") {
            args.once = true;
            continue;
        }
        if (arg === "--help") {
            args.help = true;
            continue;
        }
        throw new Error(`unknown argument: ${arg}`);
    }
    return args;
}
