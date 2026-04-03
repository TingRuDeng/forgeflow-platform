import fs from "node:fs";
import path from "node:path";
function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
export function buildDispatchServerPayload(input) {
    const orchestratorDir = path.resolve(input.orchestratorDir);
    const ledger = readJson(path.join(orchestratorDir, "task-ledger.json"));
    const assignmentsRoot = path.join(orchestratorDir, "assignments");
    const taskDirectories = fs.existsSync(assignmentsRoot)
        ? fs.readdirSync(assignmentsRoot).sort()
        : [];
    const packages = taskDirectories.map((taskId) => {
        const assignmentDir = path.join(assignmentsRoot, taskId);
        return {
            taskId,
            assignment: readJson(path.join(assignmentDir, "assignment.json")),
            workerPrompt: fs.readFileSync(path.join(assignmentDir, "worker-prompt.md"), "utf8"),
            contextMarkdown: fs.readFileSync(path.join(assignmentDir, "context.md"), "utf8"),
        };
    });
    return {
        repo: ledger.repo,
        defaultBranch: ledger.defaultBranch,
        requestedBy: input.requestedBy ?? "codex-control",
        createdAt: ledger.generatedAt,
        tasks: ledger.tasks.map((task) => ({
            id: task.id,
            title: task.title,
            pool: task.pool,
            allowedPaths: task.allowedPaths ?? [],
            acceptance: task.acceptance ?? [],
            dependsOn: task.dependsOn ?? [],
            branchName: task.branchName,
            verification: task.verification ?? { mode: "run" },
        })),
        packages,
    };
}
export async function postDispatchServerPayload(input) {
    const response = await fetch(`${input.dispatcherUrl.replace(/\/$/, "")}/api/dispatches`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
        },
        body: JSON.stringify(input.payload),
    });
    const text = await response.text();
    const json = text ? JSON.parse(text) : {};
    if (!response.ok) {
        throw new Error(json.error || text || `dispatch publish failed: ${response.status}`);
    }
    return json;
}
