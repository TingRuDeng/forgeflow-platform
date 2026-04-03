#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
const CODEX_MODEL = process.env.FORGEFLOW_CODEX_MODEL?.trim() || "";
const GEMINI_MODEL = "gemini-2.5-pro";
const EXEC_TIMEOUT_MS = Number(process.env.FORGEFLOW_EXEC_TIMEOUT_MS) || 300_000;
const VERIFICATION_TIMEOUT_MS = Number(process.env.FORGEFLOW_VERIFICATION_TIMEOUT_MS) || 60_000;
let resolvedVerificationShell = "";
function parseArgs(argv) {
    const args = {
        outputDir: "",
        dryRun: false,
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        const next = argv[index + 1];
        if (arg === "--assignment-dir" && next) {
            args.assignmentDir = next;
            index += 1;
            continue;
        }
        if (arg === "--worktree-dir" && next) {
            args.worktreeDir = next;
            index += 1;
            continue;
        }
        if (arg === "--output-dir" && next) {
            args.outputDir = next;
            index += 1;
            continue;
        }
        if (arg === "--dry-run") {
            args.dryRun = true;
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
function printHelp() {
    console.log(`
Usage:
  node scripts/run-worker-assignment.js \\
    --assignment-dir .orchestrator/assignments/task-1 \\
    --worktree-dir /abs/path/to/worktree \\
    [--output-dir /abs/path/to/output] \\
    [--dry-run]
`);
}
function validateArgs(args) {
    if (!args.assignmentDir) {
        throw new Error("--assignment-dir is required");
    }
    if (!args.worktreeDir) {
        throw new Error("--worktree-dir is required");
    }
}
function readUtf8(filePath) {
    return fs.readFileSync(filePath, "utf8");
}
function buildPrompt(workerPrompt, contextMarkdown) {
    return `${workerPrompt.trim()}\n\n${contextMarkdown.trim()}\n`;
}
function buildLaunchCommand(assignment, prompt, worktreeDir) {
    if (assignment.pool === "codex") {
        const argv = ["codex", "exec"];
        if (CODEX_MODEL) {
            argv.push("-m", CODEX_MODEL);
        }
        argv.push("--sandbox", "workspace-write", prompt);
        return {
            provider: "codex",
            argv,
            cwd: worktreeDir,
        };
    }
    return {
        provider: "gemini",
        argv: ["gemini", "-m", GEMINI_MODEL, "-p", prompt],
        cwd: worktreeDir,
    };
}
function buildVerificationCommands(assignment, worktreeDir) {
    const shell = getVerificationShell();
    return Object.values(assignment.commands).map((command) => ({
        command,
        argv: [
            shell,
            "-lc",
            `export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; nvm use 22 >/dev/null 2>&1 || true; ${command}`,
        ],
        cwd: worktreeDir,
    }));
}
function resolveVerificationShell() {
    const candidates = [
        process.env.FORGEFLOW_VERIFICATION_SHELL?.trim(),
        "zsh",
        "bash",
        "sh",
    ].filter(Boolean);
    for (const candidate of candidates) {
        const probe = spawnSync(candidate, ["-lc", "exit 0"], {
            encoding: "utf8",
        });
        if ((probe.status ?? 1) === 0) {
            return candidate;
        }
        if (probe.error?.code === "ENOENT") {
            continue;
        }
    }
    throw new Error(`unable to find a compatible verification shell (${candidates.join(", ")})`);
}
function getVerificationShell() {
    if (!resolvedVerificationShell) {
        resolvedVerificationShell = resolveVerificationShell();
    }
    return resolvedVerificationShell;
}
function inferCommonRepoRoot(worktreeDir) {
    const result = spawnSync("git", ["rev-parse", "--git-common-dir"], {
        cwd: worktreeDir,
        encoding: "utf8",
    });
    if ((result.status ?? 1) !== 0) {
        return null;
    }
    const commonDir = result.stdout.trim();
    if (!commonDir) {
        return null;
    }
    const resolved = path.resolve(worktreeDir, commonDir);
    return path.dirname(resolved);
}
function ensureWorkspaceDependencies(worktreeDir) {
    const nodeModulesPath = path.join(worktreeDir, "node_modules");
    if (fs.existsSync(nodeModulesPath)) {
        return;
    }
    const commonRepoRoot = inferCommonRepoRoot(worktreeDir);
    if (!commonRepoRoot) {
        return;
    }
    const sharedNodeModules = path.join(commonRepoRoot, "node_modules");
    if (!fs.existsSync(sharedNodeModules)) {
        return;
    }
    fs.symlinkSync(sharedNodeModules, nodeModulesPath, "junction");
}
function runCommandWithTimeout(command, timeoutMs) {
    return new Promise((resolve) => {
        let stdout = "";
        let stderr = "";
        let killed = false;
        const proc = spawn(command.argv[0], command.argv.slice(1), {
            cwd: command.cwd,
        });
        const timer = setTimeout(() => {
            killed = true;
            proc.kill("SIGKILL");
        }, timeoutMs);
        proc.stdout?.on("data", (data) => {
            stdout += data.toString();
        });
        proc.stderr?.on("data", (data) => {
            stderr += data.toString();
        });
        proc.on("close", (code) => {
            clearTimeout(timer);
            resolve({
                exitCode: killed ? 124 : (code ?? 1),
                output: `${stdout}${stderr}`.trim(),
                killed,
                timedOut: killed,
            });
        });
        proc.on("error", (error) => {
            clearTimeout(timer);
            resolve({
                exitCode: 1,
                output: `${stdout}${stderr}`.trim(),
                error: error.message,
                killed: false,
                timedOut: false,
            });
        });
    });
}
function buildWorkerResult({ assignment, provider, output, verification, generatedAt }) {
    return {
        taskId: assignment.taskId,
        workerId: assignment.workerId,
        provider,
        pool: assignment.pool,
        branchName: assignment.branchName,
        repo: assignment.repo,
        defaultBranch: assignment.defaultBranch,
        mode: "run",
        output,
        generatedAt,
        verification: {
            allPassed: verification.every((item) => item.exitCode === 0),
            commands: verification,
        },
    };
}
async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        printHelp();
        return;
    }
    validateArgs(args);
    const assignmentDir = path.resolve(args.assignmentDir);
    const outputDir = path.resolve(args.outputDir || assignmentDir);
    ensureWorkspaceDependencies(args.worktreeDir);
    const assignment = JSON.parse(readUtf8(path.join(assignmentDir, "assignment.json")));
    const workerPrompt = readUtf8(path.join(assignmentDir, "worker-prompt.md"));
    const contextMarkdown = readUtf8(path.join(assignmentDir, "context.md"));
    const prompt = buildPrompt(workerPrompt, contextMarkdown);
    const launch = buildLaunchCommand(assignment, prompt, args.worktreeDir);
    const verificationCommands = buildVerificationCommands(assignment, args.worktreeDir);
    if (args.dryRun) {
        console.log(JSON.stringify({
            assignmentDir,
            outputDir,
            launch,
            verificationCommands,
        }, null, 2));
        return;
    }
    fs.mkdirSync(outputDir, { recursive: true });
    const launchResult = await runCommandWithTimeout(launch, EXEC_TIMEOUT_MS);
    if (launchResult.timedOut) {
        console.error(`codex exec timed out after ${EXEC_TIMEOUT_MS}ms, killing process...`);
    }
    const verification = [];
    for (const command of verificationCommands) {
        const result = await runCommandWithTimeout(command, VERIFICATION_TIMEOUT_MS);
        verification.push({
            command: command.command,
            exitCode: result.exitCode,
            output: result.output,
            timedOut: result.timedOut,
        });
    }
    const generatedAt = new Date().toISOString();
    const finalOutput = launchResult.timedOut
        ? `${launchResult.output}\n\n[TIMEOUT] codex exec timed out after ${EXEC_TIMEOUT_MS}ms`
        : launchResult.output;
    const workerResult = buildWorkerResult({
        assignment,
        provider: launch.provider,
        output: finalOutput,
        verification,
        generatedAt,
    });
    fs.writeFileSync(path.join(outputDir, "worker-output.raw.txt"), `${finalOutput}\n`);
    fs.writeFileSync(path.join(outputDir, "worker-result.json"), `${JSON.stringify(workerResult, null, 2)}\n`);
    fs.writeFileSync(path.join(outputDir, "worker-verification.json"), `${JSON.stringify(workerResult.verification, null, 2)}\n`);
    const isFailed = launchResult.exitCode !== 0 || launchResult.timedOut || !workerResult.verification.allPassed;
    console.log(JSON.stringify({
        status: isFailed ? "failed" : "completed",
        provider: launch.provider,
        taskId: assignment.taskId,
        outputDir,
        verificationPassed: workerResult.verification.allPassed,
        timedOut: launchResult.timedOut,
    }, null, 2));
    if (isFailed) {
        process.exit(launchResult.timedOut ? 124 : (launchResult.exitCode || 1));
    }
}
main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
