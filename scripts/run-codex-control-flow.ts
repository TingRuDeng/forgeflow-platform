#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { buildDispatchServerPayload, postDispatchServerPayload } from "./lib/dispatch-orchestrator.js";

const DEFAULT_WORKFLOW = "ai-dispatch.yml";
const DEFAULT_ARTIFACT = "dispatch-plan";

interface ParsedArgs {
  workflow: string;
  artifactName: string;
  taskType: string;
  plannerProvider: string;
  tokenEnv: string;
  pollIntervalSeconds: number;
  timeoutSeconds: number;
  dryRun: boolean;
  repo?: string;
  ref?: string;
  repoDir?: string;
  orchestratorDir?: string;
  requestSummary?: string;
  plannerJson?: string;
  dispatcherUrl?: string;
  help?: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    workflow: DEFAULT_WORKFLOW,
    artifactName: DEFAULT_ARTIFACT,
    taskType: "feature",
    plannerProvider: "manual",
    tokenEnv: "GITHUB_TOKEN",
    pollIntervalSeconds: 5,
    timeoutSeconds: 180,
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
    if (arg === "--repo-dir" && next) {
      args.repoDir = next;
      index += 1;
      continue;
    }
    if (arg === "--orchestrator-dir" && next) {
      args.orchestratorDir = next;
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
    if (arg === "--dispatcher-url" && next) {
      args.dispatcherUrl = next;
      index += 1;
      continue;
    }
    if (arg === "--artifact-name" && next) {
      args.artifactName = next;
      index += 1;
      continue;
    }
    if (arg === "--token-env" && next) {
      args.tokenEnv = next;
      index += 1;
      continue;
    }
    if (arg === "--poll-interval-seconds" && next) {
      args.pollIntervalSeconds = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--timeout-seconds" && next) {
      args.timeoutSeconds = Number(next);
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

function printHelp(): void {
  console.log(`
Usage:
  node scripts/run-codex-control-flow.js \\
    --repo owner/repo \\
    --ref master \\
    --repo-dir /abs/path/to/business-repo \\
    --request-summary "补充接入文档并增加 API 冒烟测试" \\
    --task-type feature \\
    --planner-provider manual \\
    --planner-json-file /tmp/planner-output.json

Options:
  --repo                  target GitHub repo, e.g. TingRuDeng/openclaw-multi-agent-mvp
  --ref                   branch or tag to dispatch on
  --repo-dir              local business repo path used for worker execution
  --orchestrator-dir      local .orchestrator path, default <repo-dir>/.orchestrator
  --request-summary       workflow input request_summary
  --task-type             workflow input task_type
  --planner-provider      manual | codex | gemini
  --planner-json          inline planner_output_json
  --planner-json-file     load planner_output_json from file
  --workflow              workflow file name, default ai-dispatch.yml
  --dispatcher-url        optional dispatcher server URL; publish tasks there instead of local execution
  --artifact-name         artifact to download, default dispatch-plan
  --token-env             env var name for GitHub token, default GITHUB_TOKEN
  --poll-interval-seconds poll interval while waiting for workflow, default 5
  --timeout-seconds       overall wait timeout, default 180
  --dry-run               print planned steps instead of sending
`);
}

function validateArgs(args: ParsedArgs): void {
  if (!args.repo) {
    throw new Error("--repo is required");
  }
  if (!args.ref) {
    throw new Error("--ref is required");
  }
  if (!args.repoDir) {
    throw new Error("--repo-dir is required");
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
  if (!Number.isFinite(args.pollIntervalSeconds) || args.pollIntervalSeconds <= 0) {
    throw new Error("--poll-interval-seconds must be a positive number");
  }
  if (!Number.isFinite(args.timeoutSeconds) || args.timeoutSeconds <= 0) {
    throw new Error("--timeout-seconds must be a positive number");
  }
}

function splitRepo(repo: string): { owner: string; name: string } {
  const [owner, name] = repo.split("/");
  if (!owner || !name) {
    throw new Error(`invalid repo: ${repo}`);
  }
  return { owner, name };
}

function buildDispatchPayload(args: ParsedArgs): { ref: string; inputs: Record<string, string> } {
  return {
    ref: args.ref!,
    inputs: {
      request_summary: args.requestSummary!,
      task_type: args.taskType,
      planner_provider: args.plannerProvider,
      planner_output_json: args.plannerJson ?? "",
    },
  };
}

async function githubRequest(url: string, token: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`github request failed: ${response.status} ${response.statusText}\n${body}`);
  }

  return response;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface WorkflowRun {
  id: number;
  status?: string;
  conclusion?: string;
  created_at?: string;
  html_url?: string;
}

async function waitForWorkflowRun({ repo, workflow, ref, token, startedAt, timeoutSeconds, pollIntervalSeconds }: { repo: string; workflow: string; ref: string; token: string; startedAt: number; timeoutSeconds: number; pollIntervalSeconds: number }): Promise<WorkflowRun> {
  const deadline = Date.now() + timeoutSeconds * 1000;

  while (Date.now() < deadline) {
    const response = await githubRequest(
      `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/runs?event=workflow_dispatch&branch=${encodeURIComponent(ref)}&per_page=10`,
      token,
    );
    const payload = await response.json();
    const runs = Array.isArray(payload.workflow_runs) ? payload.workflow_runs : [];
    const matched = runs.find((run: WorkflowRun) => {
      const createdAt = Date.parse(run.created_at ?? "");
      return Number.isFinite(createdAt) && createdAt >= startedAt - 1000;
    });

    if (matched) {
      if (matched.status === "completed") {
        if (matched.conclusion !== "success") {
          throw new Error(`workflow run failed: ${matched.html_url ?? matched.id}`);
        }
        return matched;
      }
    }

    await sleep(pollIntervalSeconds * 1000);
  }

  throw new Error("timed out waiting for workflow run to complete");
}

async function downloadArtifactZip({ repo, runId, artifactName, token, outputZipFile }: { repo: string; runId: number; artifactName: string; token: string; outputZipFile: string }): Promise<void> {
  const response = await githubRequest(
    `https://api.github.com/repos/${repo}/actions/runs/${runId}/artifacts`,
    token,
  );
  const payload = await response.json();
  const artifacts = Array.isArray(payload.artifacts) ? payload.artifacts : [];
  const artifact = artifacts.find((candidate: { name: string; expired: boolean }) => candidate.name === artifactName && !candidate.expired);

  if (!artifact) {
    throw new Error(`artifact not found: ${artifactName}`);
  }

  const zipResponse = await githubRequest(
    artifact.archive_download_url,
    token,
    {
      headers: {
        Accept: "application/vnd.github+json",
      },
      redirect: "follow",
    },
  );
  const arrayBuffer = await zipResponse.arrayBuffer();
  fs.writeFileSync(outputZipFile, Buffer.from(arrayBuffer));
}

function unzipArtifact(zipFile: string, targetDir: string): void {
  fs.mkdirSync(targetDir, { recursive: true });
  const result = spawnSync("unzip", ["-o", zipFile, "-d", targetDir], {
    encoding: "utf8",
  });

  if ((result.status ?? 1) !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "failed to unzip artifact");
  }
}

function runDispatchAssignments(orchestratorDir: string, repoDir: string): Record<string, unknown> {
  const result = spawnSync(
    "node",
    [
      path.resolve("scripts/run-dispatch-assignments.js"),
      "--orchestrator-dir",
      orchestratorDir,
      "--repo-dir",
      repoDir,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: process.env,
    },
  );

  if ((result.status ?? 1) !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "failed to run dispatch assignments");
  }

  return JSON.parse(result.stdout.trim());
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  validateArgs(args);
  const token = process.env[args.tokenEnv];
  const repoDir = path.resolve(args.repoDir!);
  const orchestratorDir = path.resolve(args.orchestratorDir ?? path.join(repoDir, ".orchestrator"));
  const payload = buildDispatchPayload(args);
  const flowSummary = {
    repo: args.repo,
    ref: args.ref,
    repoDir,
    orchestratorDir,
    workflow: args.workflow,
    artifactName: args.artifactName,
    plannerProvider: args.plannerProvider,
    requestSummary: args.requestSummary,
  };

  if (args.dryRun) {
    console.log(JSON.stringify({
      ...flowSummary,
      dispatcherUrl: args.dispatcherUrl ?? null,
      payload,
      steps: [
        "dispatch workflow",
        "wait for workflow completion",
        "download dispatch artifact",
        "extract .orchestrator",
        args.dispatcherUrl
          ? "publish tasks to dispatcher server"
          : "run assigned tasks locally",
      ],
    }, null, 2));
    return;
  }

  if (!token) {
    throw new Error(`missing token env: ${args.tokenEnv}`);
  }

  const startedAt = Date.now();
  await githubRequest(
    `https://api.github.com/repos/${args.repo}/actions/workflows/${args.workflow}/dispatches`,
    token,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  const run = await waitForWorkflowRun({
    repo: args.repo!,
    workflow: args.workflow,
    ref: args.ref!,
    token,
    startedAt,
    timeoutSeconds: args.timeoutSeconds,
    pollIntervalSeconds: args.pollIntervalSeconds,
  });

  fs.mkdirSync(orchestratorDir, { recursive: true });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-control-flow-"));
  const zipFile = path.join(tempDir, `${args.artifactName}.zip`);
  try {
    await downloadArtifactZip({
      repo: args.repo!,
      runId: run.id,
      artifactName: args.artifactName,
      token,
      outputZipFile: zipFile,
    });
    unzipArtifact(zipFile, orchestratorDir);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  if (args.dispatcherUrl) {
    const dispatchPayload = buildDispatchServerPayload({
      orchestratorDir,
      requestedBy: "codex-control",
    });
    const dispatchResult = await postDispatchServerPayload({
      dispatcherUrl: args.dispatcherUrl,
      payload: dispatchPayload,
    });

    console.log(JSON.stringify({
      status: "completed",
      workflowRunId: run.id,
      workflowRunUrl: run.html_url,
      dispatchResult,
    }, null, 2));
    return;
  }

  const executionSummary = runDispatchAssignments(orchestratorDir, repoDir);

  console.log(JSON.stringify({
    status: "completed",
    workflowRunId: run.id,
    workflowRunUrl: run.html_url,
    executionSummary,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
