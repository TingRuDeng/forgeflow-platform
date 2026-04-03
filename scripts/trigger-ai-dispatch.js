#!/usr/bin/env node
import fs from "node:fs";
function parseArgs(argv) {
    const args = {
        workflow: "ai-dispatch.yml",
        taskType: "feature",
        plannerProvider: "manual",
        tokenEnv: "GITHUB_TOKEN",
        dryRun: false,
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        const next = argv[index + 1];
        if (arg === "--repo" && next) {
            args.repo = next;
            index += 1;
            continue;
        }
        if (arg === "--ref" && next) {
            args.ref = next;
            index += 1;
            continue;
        }
        if (arg === "--request-summary" && next) {
            args.requestSummary = next;
            index += 1;
            continue;
        }
        if (arg === "--task-type" && next) {
            args.taskType = next;
            index += 1;
            continue;
        }
        if (arg === "--planner-provider" && next) {
            args.plannerProvider = next;
            index += 1;
            continue;
        }
        if (arg === "--planner-json" && next) {
            args.plannerJson = next;
            index += 1;
            continue;
        }
        if (arg === "--planner-json-file" && next) {
            args.plannerJson = fs.readFileSync(next, "utf8").trim();
            index += 1;
            continue;
        }
        if (arg === "--workflow" && next) {
            args.workflow = next;
            index += 1;
            continue;
        }
        if (arg === "--token-env" && next) {
            args.tokenEnv = next;
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
  node scripts/trigger-ai-dispatch.js \\
    --repo owner/repo \\
    --ref master \\
    --request-summary "补充接入文档并增加 API 冒烟测试" \\
    --task-type feature \\
    --planner-provider manual \\
    --planner-json-file /tmp/planner-output.json

Options:
  --repo                target GitHub repo, e.g. TingRuDeng/openclaw-multi-agent-mvp
  --ref                 branch or tag to dispatch on
  --request-summary     workflow input request_summary
  --task-type           workflow input task_type
  --planner-provider    manual | codex | gemini
  --planner-json        inline planner_output_json
  --planner-json-file   load planner_output_json from file
  --workflow            workflow file name, default ai-dispatch.yml
  --token-env           env var name for GitHub token, default GITHUB_TOKEN
  --dry-run             print request payload instead of sending
`);
}
function validateArgs(args) {
    if (!args.repo) {
        throw new Error("--repo is required");
    }
    if (!args.ref) {
        throw new Error("--ref is required");
    }
    if (!args.requestSummary) {
        throw new Error("--request-summary is required");
    }
    if (!["manual", "codex", "gemini"].includes(args.plannerProvider)) {
        throw new Error("--planner-provider must be manual, codex, or gemini");
    }
    if (args.plannerProvider === "manual" && !args.plannerJson) {
        throw new Error("manual planner dispatch requires --planner-json or --planner-json-file");
    }
}
function buildPayload(args) {
    return {
        ref: args.ref,
        inputs: {
            request_summary: args.requestSummary,
            task_type: args.taskType,
            planner_provider: args.plannerProvider,
            planner_output_json: args.plannerJson ?? "",
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
    const payload = buildPayload(args);
    if (args.dryRun) {
        console.log(JSON.stringify({
            repo: args.repo,
            workflow: args.workflow,
            tokenEnv: args.tokenEnv,
            payload,
        }, null, 2));
        return;
    }
    const token = process.env[args.tokenEnv];
    if (!token) {
        throw new Error(`missing token env: ${args.tokenEnv}`);
    }
    const response = await fetch(`https://api.github.com/repos/${args.repo}/actions/workflows/${args.workflow}/dispatches`, {
        method: "POST",
        headers: {
            "Accept": "application/vnd.github+json",
            "Authorization": `Bearer ${token}`,
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`dispatch failed: ${response.status} ${response.statusText}\n${body}`);
    }
    console.log(JSON.stringify({
        status: "queued",
        repo: args.repo,
        workflow: args.workflow,
        ref: args.ref,
        plannerProvider: args.plannerProvider,
    }, null, 2));
}
main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
