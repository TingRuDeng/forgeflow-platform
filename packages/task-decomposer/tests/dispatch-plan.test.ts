import { describe, expect, it } from "vitest";

import {
  buildAssignmentRecord,
  buildAssignmentPackages,
  buildDispatchPlan,
  buildDispatchRecord,
  extractPlannerOutputJson,
  buildPlannerPromptMarkdown,
  buildTaskLedger,
  buildWorkerRegistry,
  parsePlannerOutputJson,
  parseProjectContractYaml,
  renderDispatchSummaryMarkdown,
} from "../src/index.js";

const projectContract = `
project:
  key: openclaw-multi-agent-mvp
  repo: TingRuDeng/openclaw-multi-agent-mvp
  default_branch: master

routing:
  codex:
    - src/**
    - plugins/**
  gemini:
    - docs/**
    - README.md

commands:
  test: pnpm test
  build: pnpm typecheck

worktree:
  root_dir: .worktrees
  branch_template: ai/{pool}/{task_id}-{slug}
  sync_from_default_branch: true

providers:
  enabled:
    - codex
    - gemini
  capacity:
    codex: 2
    gemini: 1
`;

describe("parseProjectContractYaml", () => {
  it("parses the minimal project contract fields needed for dispatch", () => {
    const parsed = parseProjectContractYaml(projectContract);

    expect(parsed.project.repo).toBe("TingRuDeng/openclaw-multi-agent-mvp");
    expect(parsed.project.default_branch).toBe("master");
    expect(parsed.routing.codex).toEqual(["src/**", "plugins/**"]);
    expect(parsed.routing.gemini).toEqual(["docs/**", "README.md"]);
    expect(parsed.commands).toEqual({
      test: "pnpm test",
      build: "pnpm typecheck",
    });
    expect(parsed.worktree.branch_template).toBe("ai/{pool}/{task_id}-{slug}");
    expect(parsed.providers.capacity).toEqual({
      codex: 2,
      gemini: 1,
    });
  });
});

describe("buildDispatchPlan", () => {
  it("builds a minimal structured dispatch plan from a summary and project contract", () => {
    const plan = buildDispatchPlan({
      requestSummary: "Improve README and add API smoke test",
      taskType: "feature",
      projectContractYaml: projectContract,
    });

    expect(plan.tasks).toHaveLength(2);
    expect(plan.suggestedPools).toEqual(["gemini", "codex"]);
    expect(plan.tasks[0]).toMatchObject({
      id: "task-1",
      pool: "gemini",
      allowedPaths: ["docs/**", "README.md"],
      branchName: "ai/gemini/task-1-frontend-improve-readme-and-add-api-smoke-test",
    });
    expect(plan.tasks[1]).toMatchObject({
      id: "task-2",
      pool: "codex",
      allowedPaths: ["src/**", "plugins/**"],
      branchName: "ai/codex/task-2-backend-improve-readme-and-add-api-smoke-test",
    });
  });

  it("routes Chinese documentation and api requests to both gemini and codex", () => {
    const plan = buildDispatchPlan({
      requestSummary: "补充接入文档并增加 API 冒烟测试",
      taskType: "feature",
      projectContractYaml: projectContract,
    });

    expect(plan.suggestedPools).toEqual(["gemini", "codex"]);
    expect(plan.tasks[0]).toMatchObject({
      pool: "gemini",
      allowedPaths: ["docs/**", "README.md"],
    });
    expect(plan.tasks[1]).toMatchObject({
      pool: "codex",
      allowedPaths: ["src/**", "plugins/**"],
    });
  });

  it("keeps meaningful Chinese words in branch names", () => {
    const plan = buildDispatchPlan({
      requestSummary: "验证 ForgeFlow 已成功接入此仓库，并生成任务草案",
      taskType: "feature",
      projectContractYaml: projectContract,
    });

    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0]?.branchName).toBe(
      "ai/gemini/task-1-frontend-验证-forgeflow-已成功接入此仓库-并生成任务草案",
    );
  });

  it("prefers AI planner output over heuristic routing when provided", () => {
    const plan = buildDispatchPlan({
      requestSummary: "前后端开发",
      taskType: "feature",
      projectContractYaml: projectContract,
      plannerOutputJson: JSON.stringify({
        tasks: [
          {
            title: "前端页面与交互实现",
            pool: "gemini",
            allowedPaths: ["docs/**", "README.md"],
            verification: { mode: "run" },
          },
          {
            title: "后端接口与测试实现",
            pool: "codex",
            allowedPaths: ["src/**", "plugins/**"],
            verification: { mode: "run" },
          },
        ],
      }),
    });

    expect(plan.suggestedPools).toEqual(["gemini", "codex"]);
    expect(plan.tasks).toEqual([
      expect.objectContaining({
        pool: "gemini",
        title: "前端页面与交互实现",
      }),
      expect.objectContaining({
        pool: "codex",
        title: "后端接口与测试实现",
      }),
    ]);
  });
});

describe("parsePlannerOutputJson", () => {
  it("parses structured AI planner output", () => {
    const parsed = parsePlannerOutputJson(
      JSON.stringify({
        tasks: [
          {
            title: "前端任务",
            pool: "gemini",
            allowedPaths: ["docs/**"],
            verification: { mode: "run" },
          },
        ],
      }),
    );

    expect(parsed.tasks).toEqual([
      {
        title: "前端任务",
        pool: "gemini",
        allowedPaths: ["docs/**"],
        verification: { mode: "run" },
      },
    ]);
  });
});

describe("extractPlannerOutputJson", () => {
  it("extracts planner JSON from a fenced code block", () => {
    const extracted = extractPlannerOutputJson(`
Here is the planner result:

\`\`\`json
{
  "tasks": [
    {
      "title": "前端任务",
      "pool": "gemini",
      "allowedPaths": ["docs/**"],
      "verification": { "mode": "run" }
    }
  ]
}
\`\`\`
`);

    expect(parsePlannerOutputJson(extracted)).toEqual({
      tasks: [
        {
          title: "前端任务",
          pool: "gemini",
          allowedPaths: ["docs/**"],
          verification: { mode: "run" },
        },
      ],
    });
  });
});

describe("buildPlannerPromptMarkdown", () => {
  it("renders a planner prompt with repo boundaries and output contract", () => {
    const prompt = buildPlannerPromptMarkdown({
      requestSummary: "前后端开发",
      taskType: "feature",
      projectContractYaml: projectContract,
    });

    expect(prompt).toContain("# Planner Request");
    expect(prompt).toContain("Summary: 前后端开发");
    expect(prompt).toContain("Repo: TingRuDeng/openclaw-multi-agent-mvp");
    expect(prompt).toContain("- codex: src/**, plugins/**");
    expect(prompt).toContain('- gemini: docs/**, README.md');
    expect(prompt).toContain('"tasks"');
  });
});

describe("buildTaskLedger", () => {
  it("builds a task ledger with planned tasks and repo metadata", () => {
    const plan = buildDispatchPlan({
      requestSummary: "补充接入文档并增加 API 冒烟测试",
      taskType: "feature",
      projectContractYaml: projectContract,
    });

    const ledger = buildTaskLedger({
      plan,
      projectContractYaml: projectContract,
      generatedAt: "2026-03-16T06:52:00.000Z",
    });

    expect(ledger).toMatchObject({
      requestSummary: "补充接入文档并增加 API 冒烟测试",
      taskType: "feature",
      repo: "TingRuDeng/openclaw-multi-agent-mvp",
      defaultBranch: "master",
      generatedAt: "2026-03-16T06:52:00.000Z",
    });
    expect(ledger.tasks).toEqual([
      expect.objectContaining({
        id: "task-1",
        pool: "gemini",
        status: "planned",
        attempts: 0,
      }),
      expect.objectContaining({
        id: "task-2",
        pool: "codex",
        status: "planned",
        attempts: 0,
      }),
    ]);
  });

  it("defaults generatedAt to an explicit local offset timestamp", () => {
    const plan = buildDispatchPlan({
      requestSummary: "补充接入文档并增加 API 冒烟测试",
      taskType: "feature",
      projectContractYaml: projectContract,
    });

    const ledger = buildTaskLedger({
      plan,
      projectContractYaml: projectContract,
    });

    expect(ledger.generatedAt).toMatch(/[+-]\d{2}:\d{2}$/);
    expect(ledger.generatedAt.endsWith("Z")).toBe(false);
  });
});

describe("renderDispatchSummaryMarkdown", () => {
  it("renders a readable markdown summary for humans", () => {
    const plan = buildDispatchPlan({
      requestSummary: "补充接入文档并增加 API 冒烟测试",
      taskType: "feature",
      projectContractYaml: projectContract,
    });
    const ledger = buildTaskLedger({
      plan,
      projectContractYaml: projectContract,
      generatedAt: "2026-03-16T06:52:00.000Z",
    });

    const summary = renderDispatchSummaryMarkdown({ plan, ledger });

    expect(summary).toContain("# Dispatch Summary");
    expect(summary).toContain("## Request");
    expect(summary).toContain("补充接入文档并增加 API 冒烟测试");
    expect(summary).toContain("## Suggested Pools");
    expect(summary).toContain("- gemini");
    expect(summary).toContain("- codex");
    expect(summary).toContain("## Tasks");
    expect(summary).toContain("### task-1 - Frontend: 补充接入文档并增加 API 冒烟测试");
    expect(summary).toContain("- Status: planned");
    expect(summary).toContain("- Branch: `ai/gemini/task-1-frontend-补充接入文档并增加-api-冒烟测试`");
  });
});

describe("buildWorkerRegistry", () => {
  it("builds idle workers from provider capacity", () => {
    const registry = buildWorkerRegistry({
      projectContractYaml: projectContract,
      generatedAt: "2026-03-16T07:00:00.000Z",
    });

    expect(registry).toEqual([
      {
        id: "codex-worker-1",
        pool: "codex",
        status: "idle",
        lastHeartbeatAt: "2026-03-16T07:00:00.000Z",
      },
      {
        id: "codex-worker-2",
        pool: "codex",
        status: "idle",
        lastHeartbeatAt: "2026-03-16T07:00:00.000Z",
      },
      {
        id: "gemini-worker-1",
        pool: "gemini",
        status: "idle",
        lastHeartbeatAt: "2026-03-16T07:00:00.000Z",
      },
    ]);
  });
});

describe("buildDispatchRecord", () => {
  it("advances planned tasks to ready and records events", () => {
    const plan = buildDispatchPlan({
      requestSummary: "补充接入文档并增加 API 冒烟测试",
      taskType: "feature",
      projectContractYaml: projectContract,
    });

    const record = buildDispatchRecord({
      plan,
      projectContractYaml: projectContract,
      generatedAt: "2026-03-16T06:55:00.000Z",
    });

    expect(record.ledger.tasks).toEqual([
      expect.objectContaining({
        id: "task-1",
        status: "ready",
      }),
      expect.objectContaining({
        id: "task-2",
        status: "ready",
      }),
    ]);
    expect(record.events).toEqual([
      expect.objectContaining({
        taskId: "task-1",
        type: "created",
      }),
      expect.objectContaining({
        taskId: "task-1",
        type: "status_changed",
        payload: {
          from: "planned",
          to: "ready",
        },
      }),
      expect.objectContaining({
        taskId: "task-2",
        type: "created",
      }),
      expect.objectContaining({
        taskId: "task-2",
        type: "status_changed",
        payload: {
          from: "planned",
          to: "ready",
        },
      }),
    ]);
  });
});

describe("buildAssignmentRecord", () => {
  it("assigns ready tasks to matching idle workers and records events", () => {
    const plan = buildDispatchPlan({
      requestSummary: "补充接入文档并增加 API 冒烟测试",
      taskType: "feature",
      projectContractYaml: projectContract,
    });

    const record = buildAssignmentRecord({
      plan,
      projectContractYaml: projectContract,
      generatedAt: "2026-03-16T07:05:00.000Z",
    });

    expect(record.ledger.tasks).toEqual([
      expect.objectContaining({
        id: "task-1",
        status: "assigned",
        assignedWorkerId: "gemini-worker-1",
      }),
      expect.objectContaining({
        id: "task-2",
        status: "assigned",
        assignedWorkerId: "codex-worker-1",
      }),
    ]);
    expect(record.workers).toEqual([
      expect.objectContaining({
        id: "codex-worker-1",
        status: "busy",
        currentTaskId: "task-2",
      }),
      expect.objectContaining({
        id: "codex-worker-2",
        status: "idle",
      }),
      expect.objectContaining({
        id: "gemini-worker-1",
        status: "busy",
        currentTaskId: "task-1",
      }),
    ]);
    expect(record.assignments).toEqual([
      {
        taskId: "task-1",
        workerId: "gemini-worker-1",
        pool: "gemini",
        status: "assigned",
      },
      {
        taskId: "task-2",
        workerId: "codex-worker-1",
        pool: "codex",
        status: "assigned",
      },
    ]);
    expect(record.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "task-1",
          type: "status_changed",
          payload: {
            from: "ready",
            to: "assigned",
          },
        }),
        expect.objectContaining({
          taskId: "task-2",
          type: "status_changed",
          payload: {
            from: "ready",
            to: "assigned",
          },
        }),
      ]),
    );
  });

  it("uses the next idle worker in the same pool and leaves overflow tasks pending", () => {
    const record = buildAssignmentRecord({
      plan: {
        requestSummary: "后端批量任务",
        taskType: "feature",
        suggestedPools: ["codex"],
        tasks: [
          {
            id: "task-1",
            title: "Backend: task 1",
            pool: "codex",
            allowedPaths: ["src/**"],
            branchName: "ai/codex/task-1",
            verification: { mode: "run" },
          },
          {
            id: "task-2",
            title: "Backend: task 2",
            pool: "codex",
            allowedPaths: ["src/**"],
            branchName: "ai/codex/task-2",
            verification: { mode: "run" },
          },
          {
            id: "task-3",
            title: "Backend: task 3",
            pool: "codex",
            allowedPaths: ["src/**"],
            branchName: "ai/codex/task-3",
            verification: { mode: "run" },
          },
        ],
      },
      projectContractYaml: projectContract,
      generatedAt: "2026-03-16T07:06:00.000Z",
    });

    expect(record.workers).toEqual([
      expect.objectContaining({
        id: "codex-worker-1",
        status: "busy",
        currentTaskId: "task-1",
      }),
      expect.objectContaining({
        id: "codex-worker-2",
        status: "busy",
        currentTaskId: "task-2",
      }),
      expect.objectContaining({
        id: "gemini-worker-1",
        status: "idle",
      }),
    ]);
    expect(record.assignments).toEqual([
      {
        taskId: "task-1",
        workerId: "codex-worker-1",
        pool: "codex",
        status: "assigned",
      },
      {
        taskId: "task-2",
        workerId: "codex-worker-2",
        pool: "codex",
        status: "assigned",
      },
      {
        taskId: "task-3",
        workerId: "",
        pool: "codex",
        status: "pending",
      },
    ]);
    expect(record.ledger.tasks).toEqual([
      expect.objectContaining({
        id: "task-1",
        status: "assigned",
        assignedWorkerId: "codex-worker-1",
      }),
      expect.objectContaining({
        id: "task-2",
        status: "assigned",
        assignedWorkerId: "codex-worker-2",
      }),
      expect.objectContaining({
        id: "task-3",
        status: "ready",
      }),
    ]);
  });
});

describe("buildAssignmentPackages", () => {
  it("builds assignment inputs with pool-specific prompts and context", () => {
    const plan = buildDispatchPlan({
      requestSummary: "补充接入文档并增加 API 冒烟测试",
      taskType: "feature",
      projectContractYaml: projectContract,
    });
    const record = buildAssignmentRecord({
      plan,
      projectContractYaml: projectContract,
      generatedAt: "2026-03-16T07:10:00.000Z",
    });

    const packages = buildAssignmentPackages({
      record,
      projectContractYaml: projectContract,
      agentsInstructions: "# AGENTS\n- Only modify assigned files.\n- Run verification commands.",
      geminiInstructions: "# GEMINI\n- Prefer small, typed Vue or docs changes.",
    });

    expect(packages).toHaveLength(2);
    expect(packages[0]).toMatchObject({
      taskId: "task-1",
      assignment: {
        taskId: "task-1",
        pool: "gemini",
        workerId: "gemini-worker-1",
        commands: {
          test: "pnpm test",
          build: "pnpm typecheck",
        },
      },
    });
    expect(packages[0]?.workerPrompt).toContain("你是 gemini-worker");
    expect(packages[0]?.workerPrompt).toContain("Only modify assigned files.");
    expect(packages[0]?.workerPrompt).toContain("Prefer small, typed Vue or docs changes.");
    expect(packages[0]?.contextMarkdown).toContain("## Task");
    expect(packages[0]?.contextMarkdown).toContain("补充接入文档并增加 API 冒烟测试");
    expect(packages[1]?.workerPrompt).toContain("你是 codex-worker");
    expect(packages[1]?.workerPrompt).not.toContain("Prefer small, typed Vue or docs changes.");
  });
});
