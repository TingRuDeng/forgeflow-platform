#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
function parseArgs(argv) {
    const args = {
        output: path.resolve(process.cwd(), "two-codex-drill-planner.json"),
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        const next = argv[index + 1];
        if (arg === "--output" && next) {
            args.output = path.resolve(next);
            index += 1;
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
  node scripts/create-two-codex-drill-planner.js [--output /tmp/two-codex-drill-planner.json]
`);
}
function buildPlannerOutput() {
    return {
        tasks: [
            {
                title: "为多机演练补充服务端 smoke 文档",
                pool: "codex",
                allowedPaths: ["docs/**"],
                verification: {
                    mode: "run",
                },
            },
            {
                title: "为多机演练补充 API smoke 测试说明",
                pool: "codex",
                allowedPaths: ["docs/**", "tests/**"],
                verification: {
                    mode: "run",
                },
            },
        ],
    };
}
function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        printHelp();
        return;
    }
    const plannerOutput = buildPlannerOutput();
    fs.mkdirSync(path.dirname(args.output), { recursive: true });
    fs.writeFileSync(args.output, `${JSON.stringify(plannerOutput, null, 2)}\n`);
    console.log(JSON.stringify({
        output: args.output,
        tasks: plannerOutput.tasks.length,
    }, null, 2));
}
main();
