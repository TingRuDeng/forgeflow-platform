import { describe, expect, it, vi } from "vitest";

describe("runtime/trae-dom-driver", () => {
  describe("extractAutomationResponse", () => {
    it("returns empty text with stale_baseline source when snapshot count equals baseline and no growth", async () => {
      const { extractAutomationResponse } = await import("../../src/runtime/trae-dom-driver.js");

      const baseline: Array<{ index: number; text: string; descriptor: unknown }> = [
        { index: 0, text: "Previous task response", descriptor: {} },
      ];
      const snapshot: Array<{ index: number; text: string; descriptor: unknown }> = [
        { index: 0, text: "Previous task response", descriptor: {} },
      ];

      const result = extractAutomationResponse(snapshot, baseline);

      expect(result).toEqual({
        text: "",
        source: "stale_baseline",
        snapshotCount: 1,
      });
    });

    it("returns empty text with stale_baseline source when baseline has more nodes", async () => {
      const { extractAutomationResponse } = await import("../../src/runtime/trae-dom-driver.js");

      const baseline: Array<{ index: number; text: string; descriptor: unknown }> = [
        { index: 0, text: "First response", descriptor: {} },
        { index: 1, text: "Second response", descriptor: {} },
      ];
      const snapshot: Array<{ index: number; text: string; descriptor: unknown }> = [
        { index: 0, text: "First response", descriptor: {} },
      ];

      const result = extractAutomationResponse(snapshot, baseline);

      expect(result).toEqual({
        text: "",
        source: "stale_baseline",
        snapshotCount: 1,
      });
    });

    it("extracts replacement text when the assistant rewrites the same node in place", async () => {
      const { extractAutomationResponse } = await import("../../src/runtime/trae-dom-driver.js");

      const baseline: Array<{ index: number; text: string; descriptor: unknown }> = [
        { index: 0, text: "思考中...", descriptor: {} },
      ];
      const snapshot: Array<{ index: number; text: string; descriptor: unknown }> = [
        {
          index: 0,
          text: "## 任务完成\n- 结果: 成功\n- 任务ID: dispatch-134:redrive-6f3c6ee2",
          descriptor: {},
        },
      ];

      const result = extractAutomationResponse(snapshot, baseline, { requiredPrefix: "任务完成" });

      expect(result).toEqual({
        text: "## 任务完成\n- 结果: 成功\n- 任务ID: dispatch-134:redrive-6f3c6ee2",
        source: "last_node_replaced",
        snapshotCount: 1,
      });
    });

    it("returns new_nodes when snapshot has more entries than baseline", async () => {
      const { extractAutomationResponse } = await import("../../src/runtime/trae-dom-driver.js");

      const baseline: Array<{ index: number; text: string; descriptor: unknown }> = [
        { index: 0, text: "First response", descriptor: {} },
      ];
      const snapshot: Array<{ index: number; text: string; descriptor: unknown }> = [
        { index: 0, text: "First response", descriptor: {} },
        { index: 1, text: "New response", descriptor: {} },
      ];

      const result = extractAutomationResponse(snapshot, baseline);

      expect(result.source).toBe("new_nodes");
      expect(result.text).toBe("New response");
    });

    it("returns last_node_growth when last node has additional content", async () => {
      const { extractAutomationResponse } = await import("../../src/runtime/trae-dom-driver.js");

      const baseline: Array<{ index: number; text: string; descriptor: unknown }> = [
        { index: 0, text: "Response part 1", descriptor: {} },
      ];
      const snapshot: Array<{ index: number; text: string; descriptor: unknown }> = [
        { index: 0, text: "Response part 1\nAdditional content", descriptor: {} },
      ];

      const result = extractAutomationResponse(snapshot, baseline);

      expect(result.source).toBe("last_node_growth");
      expect(result.text).toBe("\nAdditional content");
    });

    it("accepts last_node when baseline is empty and snapshot has content", async () => {
      const { extractAutomationResponse } = await import("../../src/runtime/trae-dom-driver.js");

      const baseline: Array<{ index: number; text: string; descriptor: unknown }> = [];
      const snapshot: Array<{ index: number; text: string; descriptor: unknown }> = [
        { index: 0, text: "First response", descriptor: {} },
      ];

      const result = extractAutomationResponse(snapshot, baseline);

      expect(result.text).toBe("First response");
      expect(result.source).toBe("new_nodes");
    });
  });

  it("uses prepareSession discovery hints when resolving the Trae target", async () => {
    const discoverTarget = vi.fn(async () => ({
      target: {
        id: "target-1",
        title: "ForgeFlow — task-1",
        url: "vscode-file://workbench",
      },
      version: {},
      targets: [],
    }));
    const session = {
      close: vi.fn(async () => undefined),
    };
    const connectToTarget = vi.fn(async () => session);
    const inspectReadiness = vi.fn(async () => ({ ready: true }));
    const prepareSession = vi.fn(async () => ({ ok: true, clicked: true }));
    const domAdapter = {
      inspectReadiness,
      prepareSession,
    };

    const { createTraeAutomationDriver } = await import("../../src/runtime/trae-dom-driver.js");
    const driver = createTraeAutomationDriver({
      discoverTarget,
      connectToTarget,
      domAdapter: domAdapter as never,
    });

    const result = await driver.prepareSession({
      discovery: {
        titleContains: ["dispatch-54-preflight-failure-payload-1"],
      },
    });

    expect(result).toMatchObject({
      status: "ok",
      preparation: { ok: true, clicked: true },
      target: {
        id: "target-1",
        title: "ForgeFlow — task-1",
        url: "vscode-file://workbench",
      },
    });
    expect(discoverTarget).toHaveBeenCalledWith(expect.objectContaining({
      titleContains: ["dispatch-54-preflight-failure-payload-1"],
    }));
    expect(inspectReadiness).not.toHaveBeenCalled();
    expect(prepareSession).toHaveBeenCalledTimes(1);
    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it("prepares a session even when readiness has not exposed the composer yet", async () => {
    const discoverTarget = vi.fn(async () => ({
      target: {
        id: "target-1",
        title: "ForgeFlow — task-1",
        url: "vscode-file://workbench",
      },
      version: {},
      targets: [],
    }));
    const session = {
      close: vi.fn(async () => undefined),
    };
    const connectToTarget = vi.fn(async () => session);
    const inspectReadiness = vi.fn(async () => ({
      ready: false,
      composerFound: false,
      sendButtonFound: false,
    }));
    const prepareSession = vi.fn(async () => ({ ok: true, clicked: true }));
    const domAdapter = {
      inspectReadiness,
      prepareSession,
    };

    const { createTraeAutomationDriver } = await import("../../src/runtime/trae-dom-driver.js");
    const driver = createTraeAutomationDriver({
      discoverTarget,
      connectToTarget,
      domAdapter: domAdapter as never,
    });

    await expect(driver.prepareSession({
      discovery: {
        titleContains: ["dispatch-59-preflight-failure-payload-1"],
      },
    })).resolves.toMatchObject({
      status: "ok",
      preparation: { clicked: true },
      target: {
        id: "target-1",
        title: "ForgeFlow — task-1",
        url: "vscode-file://workbench",
      },
    });

    expect(discoverTarget).toHaveBeenCalledWith(expect.objectContaining({
      titleContains: ["dispatch-59-preflight-failure-payload-1"],
    }));
    expect(inspectReadiness).not.toHaveBeenCalled();
    expect(prepareSession).toHaveBeenCalledTimes(1);
    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it("returns structured diagnostics when prepareSession fails", async () => {
    const discoverTarget = vi.fn(async () => ({
      target: {
        id: "target-1",
        title: "ForgeFlow — task-1",
        url: "vscode-file://workbench",
      },
      version: {},
      targets: [],
    }));
    const session = {
      close: vi.fn(async () => undefined),
    };
    const connectToTarget = vi.fn(async () => session);
    const inspectReadiness = vi.fn(async () => ({
      ready: false,
      title: "ForgeFlow — task-1",
      url: "vscode-file://workbench",
      composerFound: false,
      composerSelector: null,
      sendButtonFound: false,
      sendButtonSelector: null,
      readyState: "complete",
    }));
    const prepareSession = vi.fn(async () => ({ ok: false, reason: "new_chat_button_not_found" }));
    const domAdapter = {
      inspectReadiness,
      prepareSession,
    };

    const { createTraeAutomationDriver } = await import("../../src/runtime/trae-dom-driver.js");
    const driver = createTraeAutomationDriver({
      discoverTarget,
      connectToTarget,
      domAdapter: domAdapter as never,
    });

    await expect(driver.prepareSession({
      discovery: {
        titleContains: ["task-1"],
      },
    })).rejects.toMatchObject({
      code: "AUTOMATION_PREPARE_FAILED",
      details: expect.objectContaining({
        target: {
          id: "target-1",
          title: "ForgeFlow — task-1",
          url: "vscode-file://workbench",
        },
        diagnostics: expect.objectContaining({
          title: "ForgeFlow — task-1",
          url: "vscode-file://workbench",
          composerFound: false,
          composerSelector: null,
          sendButtonFound: false,
          sendButtonSelector: null,
          readyState: "complete",
        }),
      }),
    });

    expect(discoverTarget).toHaveBeenCalledTimes(1);
    expect(prepareSession).toHaveBeenCalledTimes(1);
    expect(inspectReadiness).toHaveBeenCalledTimes(1);
    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it("marks editor-like workbench pages as not ready even if generic selectors match", async () => {
    const discoverTarget = vi.fn(async () => ({
      target: {
        id: "target-1",
        title: "clients.test.ts — ForgeFlow",
        url: "vscode-file://workbench",
      },
      version: {},
      targets: [],
    }));
    const session = {
      close: vi.fn(async () => undefined),
    };
    const connectToTarget = vi.fn(async () => session);
    const inspectReadiness = vi.fn(async () => ({
      ready: true,
      title: "clients.test.ts — ForgeFlow",
      url: "vscode-file://workbench",
      composerFound: true,
      composerSelector: ".chat-input-v2-input-box-editable",
      sendButtonFound: true,
      sendButtonSelector: "button.chat-input-v2-send-button",
      newChatFound: false,
      responseFound: false,
      readyState: "complete",
    }));
    const domAdapter = {
      inspectReadiness,
    };

    const { createTraeAutomationDriver } = await import("../../src/runtime/trae-dom-driver.js");
    const driver = createTraeAutomationDriver({
      discoverTarget,
      connectToTarget,
      domAdapter: domAdapter as never,
    });

    await expect(driver.getReadiness()).resolves.toMatchObject({
      ready: false,
      target: {
        title: "clients.test.ts — ForgeFlow",
      },
      details: expect.objectContaining({
        title: "clients.test.ts — ForgeFlow",
        composerFound: true,
        sendButtonFound: true,
      }),
    });

    expect(inspectReadiness).toHaveBeenCalledTimes(1);
    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it("rejects sendPrompt when readiness only matches an editor-like workbench page", async () => {
    const discoverTarget = vi.fn(async () => ({
      target: {
        id: "target-1",
        title: "AGENT_STARTER_PROMPT.md (Preview) — ForgeFlow",
        url: "vscode-file://workbench",
      },
      version: {},
      targets: [],
    }));
    const session = {
      close: vi.fn(async () => undefined),
    };
    const connectToTarget = vi.fn(async () => session);
    const inspectReadiness = vi.fn(async () => ({
      ready: true,
      title: "AGENT_STARTER_PROMPT.md (Preview) — ForgeFlow",
      url: "vscode-file://workbench",
      composerFound: true,
      composerSelector: ".chat-input-v2-input-box-editable",
      sendButtonFound: true,
      sendButtonSelector: "button.chat-input-v2-send-button",
      newChatFound: false,
      responseFound: false,
      readyState: "complete",
    }));
    const prepareSession = vi.fn(async () => ({ ok: true, clicked: true }));
    const captureResponseSnapshot = vi.fn(async () => []);
    const submitPrompt = vi.fn(async () => ({ ok: true }));
    const domAdapter = {
      inspectReadiness,
      prepareSession,
      captureResponseSnapshot,
      submitPrompt,
    };

    const { createTraeAutomationDriver } = await import("../../src/runtime/trae-dom-driver.js");
    const driver = createTraeAutomationDriver({
      discoverTarget,
      connectToTarget,
      domAdapter: domAdapter as never,
    });

    await expect(driver.sendPrompt({
      content: "test prompt",
      prepare: true,
    })).rejects.toMatchObject({
      code: "AUTOMATION_SELECTOR_NOT_READY",
    });

    expect(inspectReadiness).toHaveBeenCalledTimes(1);
    expect(prepareSession).not.toHaveBeenCalled();
    expect(captureResponseSnapshot).not.toHaveBeenCalled();
    expect(submitPrompt).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it("accepts terminal activity text when assistant snapshot stays stale", async () => {
    const discoverTarget = vi.fn(async () => ({
      target: {
        id: "target-1",
        title: "ForgeFlow — continuation task",
        url: "vscode-file://workbench",
      },
      version: {},
      targets: [],
    }));
    const session = {
      close: vi.fn(async () => undefined),
    };
    const connectToTarget = vi.fn(async () => session);
    const inspectReadiness = vi.fn(async () => ({
      ready: true,
      title: "ForgeFlow — continuation task",
      url: "vscode-file://workbench",
      composerFound: true,
      composerSelector: ".chat-input-v2-input-box-editable",
      sendButtonFound: true,
      sendButtonSelector: "button.chat-input-v2-send-button",
      newChatFound: true,
      responseFound: false,
      readyState: "complete",
    }));
    const prepareSession = vi.fn(async () => ({ ok: true, clicked: false, skipped: true }));
    const baselineSnapshot = [
      { index: 0, text: "Previous task response", descriptor: {} },
    ];
    const finalReportText = [
      "## 任务完成",
      "- 结果: 成功",
      "- 任务ID: dispatch-112:redrive-d9d40367",
    ].join("\n");
    const activitySnapshots = [
      [],
      [{ index: 0, text: finalReportText, descriptor: {} }],
      [{ index: 0, text: finalReportText, descriptor: {} }],
    ];
    let activityPollIndex = 0;
    const captureResponseSnapshot = vi.fn(async (_session, _config, options) => {
      if (Array.isArray(options?.selectors)) {
        const next = activitySnapshots[Math.min(activityPollIndex, activitySnapshots.length - 1)];
        activityPollIndex += 1;
        return next;
      }
      return baselineSnapshot;
    });
    const submitPrompt = vi.fn(async () => ({ ok: true }));
    const domAdapter = {
      inspectReadiness,
      prepareSession,
      captureResponseSnapshot,
      submitPrompt,
    };
    let nowValue = 0;

    const { createTraeAutomationDriver } = await import("../../src/runtime/trae-dom-driver.js");
    const driver = createTraeAutomationDriver({
      discoverTarget,
      connectToTarget,
      domAdapter: domAdapter as never,
      now: () => {
        nowValue += 700;
        return nowValue;
      },
      responsePollIntervalMs: 0,
      responseIdleMs: 600,
      responseTimeoutMs: 5000,
      postActionDelayMs: 0,
    });

    await expect(driver.sendPrompt({
      content: "Please continue the task",
      prepare: true,
      responseRequiredPrefix: "任务完成",
      chatMode: "continue",
    })).resolves.toMatchObject({
      status: "ok",
      response: {
        text: finalReportText,
      },
    });

    expect(captureResponseSnapshot).toHaveBeenCalledWith(session, expect.any(Object), undefined);
    expect(captureResponseSnapshot).toHaveBeenCalledWith(
      session,
      expect.any(Object),
      expect.objectContaining({
        selectors: expect.any(Array),
        allowHiddenText: true,
      }),
    );
    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it("ignores preexisting prompt template text in activity snapshots by diffing against baseline activity", async () => {
    const discoverTarget = vi.fn(async () => ({
      target: {
        id: "target-1",
        title: "ForgeFlow — continuation task",
        url: "vscode-file://workbench",
      },
      version: {},
      targets: [],
    }));
    const session = {
      close: vi.fn(async () => undefined),
    };
    const connectToTarget = vi.fn(async () => session);
    const inspectReadiness = vi.fn(async () => ({
      ready: true,
      title: "ForgeFlow — continuation task",
      url: "vscode-file://workbench",
      composerFound: true,
      composerSelector: ".chat-input-v2-input-box-editable",
      sendButtonFound: true,
      sendButtonSelector: "button.chat-input-v2-send-button",
      newChatFound: true,
      responseFound: false,
      readyState: "complete",
    }));
    const prepareSession = vi.fn(async () => ({ ok: true, clicked: false, skipped: true }));
    const assistantBaseline = [
      { index: 0, text: "Previous task response", descriptor: {} },
    ];
    const promptTemplate = [
      "## 任务完成",
      "- 结果: 成功 / 失败",
      "- 任务ID: <task_id>",
    ].join("\n");
    const finalReportText = [
      "## 任务完成",
      "- 结果: 成功",
      "- 任务ID: dispatch-113:redrive-de851407",
    ].join("\n");
    const activitySnapshots = [
      [{ index: 0, text: promptTemplate, descriptor: {} }],
      [{ index: 0, text: `${promptTemplate}\n${finalReportText}`, descriptor: {} }],
      [{ index: 0, text: `${promptTemplate}\n${finalReportText}`, descriptor: {} }],
    ];
    let activityPollIndex = 0;
    const captureResponseSnapshot = vi.fn(async (_session, _config, options) => {
      if (Array.isArray(options?.selectors)) {
        const next = activitySnapshots[Math.min(activityPollIndex, activitySnapshots.length - 1)];
        activityPollIndex += 1;
        return next;
      }
      return assistantBaseline;
    });
    const submitPrompt = vi.fn(async () => ({ ok: true }));
    const domAdapter = {
      inspectReadiness,
      prepareSession,
      captureResponseSnapshot,
      submitPrompt,
    };
    let nowValue = 0;

    const { createTraeAutomationDriver } = await import("../../src/runtime/trae-dom-driver.js");
    const driver = createTraeAutomationDriver({
      discoverTarget,
      connectToTarget,
      domAdapter: domAdapter as never,
      now: () => {
        nowValue += 700;
        return nowValue;
      },
      responsePollIntervalMs: 0,
      responseIdleMs: 600,
      responseTimeoutMs: 5000,
      postActionDelayMs: 0,
    });

    await expect(driver.sendPrompt({
      content: "Please continue the task",
      prepare: true,
      responseRequiredPrefix: "任务完成",
      chatMode: "continue",
    })).resolves.toMatchObject({
      status: "ok",
      response: {
        text: finalReportText,
      },
    });
  });

  it("waits past a template placeholder report until a concrete final report arrives", async () => {
    const discoverTarget = vi.fn(async () => ({
      target: {
        id: "target-1",
        title: "ForgeFlow — continuation task",
        url: "vscode-file://workbench",
      },
      version: {},
      targets: [],
    }));
    const session = {
      close: vi.fn(async () => undefined),
    };
    const connectToTarget = vi.fn(async () => session);
    const inspectReadiness = vi.fn(async () => ({
      ready: true,
      title: "ForgeFlow — continuation task",
      url: "vscode-file://workbench",
      composerFound: true,
      composerSelector: ".chat-input-v2-input-box-editable",
      sendButtonFound: true,
      sendButtonSelector: "button.chat-input-v2-send-button",
      newChatFound: true,
      responseFound: false,
      readyState: "complete",
    }));
    const prepareSession = vi.fn(async () => ({ ok: true, clicked: false, skipped: true }));
    const placeholderReportText = [
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
    const finalReportText = [
      "## 任务完成",
      "- 结果: 成功",
      "- 任务ID: dispatch-114:final-response",
      "- 修改文件: src/final.ts",
      "- 测试结果: pnpm test",
      "- 风险: 无",
      "- GitHub 证据:",
      "  - branch: feature/final-response",
      "  - commit: abc114",
      "  - push: 成功",
      "  - push_error: 无",
      "  - PR: 无",
      "  - PR URL: 无",
      "- 备注: final response after placeholder",
    ].join("\n");
    let responsePollIndex = 0;
    let activityPollIndex = 0;
    const captureResponseSnapshot = vi.fn(async (_session, _config, options) => {
      const snapshots = Array.isArray(options?.selectors)
        ? [
            [],
            [{ index: 0, text: placeholderReportText, descriptor: {} }],
            [{ index: 0, text: finalReportText, descriptor: {} }],
          ]
        : [
            [],
            [{ index: 0, text: placeholderReportText, descriptor: {} }],
            [{ index: 0, text: finalReportText, descriptor: {} }],
          ];
      if (Array.isArray(options?.selectors)) {
        const next = snapshots[Math.min(activityPollIndex, snapshots.length - 1)];
        activityPollIndex += 1;
        return next;
      }
      const next = snapshots[Math.min(responsePollIndex, snapshots.length - 1)];
      responsePollIndex += 1;
      return next;
    });
    const submitPrompt = vi.fn(async () => ({ ok: true }));
    const domAdapter = {
      inspectReadiness,
      prepareSession,
      captureResponseSnapshot,
      submitPrompt,
    };
    let nowValue = 0;

    const { createTraeAutomationDriver } = await import("../../src/runtime/trae-dom-driver.js");
    const driver = createTraeAutomationDriver({
      discoverTarget,
      connectToTarget,
      domAdapter: domAdapter as never,
      now: () => {
        nowValue += 700;
        return nowValue;
      },
      responsePollIntervalMs: 0,
      responseIdleMs: 600,
      responseTimeoutMs: 5000,
      postActionDelayMs: 0,
    });

    await expect(driver.sendPrompt({
      content: "Please continue the task",
      prepare: true,
      responseRequiredPrefix: "任务完成",
      chatMode: "continue",
    })).resolves.toMatchObject({
      status: "ok",
      response: {
        text: finalReportText,
      },
    });

    expect(captureResponseSnapshot).toHaveBeenCalledTimes(6);
    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it("ignores a concrete stale task report until the expected task id appears", async () => {
    const discoverTarget = vi.fn(async () => ({
      target: {
        id: "target-1",
        title: "ForgeFlow — continuation task",
        url: "vscode-file://workbench",
      },
      version: {},
      targets: [],
    }));
    const session = {
      close: vi.fn(async () => undefined),
    };
    const connectToTarget = vi.fn(async () => session);
    const inspectReadiness = vi.fn(async () => ({
      ready: true,
      title: "ForgeFlow — continuation task",
      url: "vscode-file://workbench",
      composerFound: true,
      composerSelector: ".chat-input-v2-input-box-editable",
      sendButtonFound: true,
      sendButtonSelector: "button.chat-input-v2-send-button",
      newChatFound: true,
      responseFound: false,
      readyState: "complete",
    }));
    const prepareSession = vi.fn(async () => ({ ok: true, clicked: true }));
    const staleReportText = [
      "## 任务完成",
      "- 结果: 成功",
      "- 任务ID: dispatch-150:redrive-19b26510",
      "- 修改文件: docs/onboarding.md",
      "- 测试结果: none",
      "- 风险: 无",
      "- GitHub 证据:",
      "  - branch: ai/trae/harden-dispatcher-auth-defaults-20260404-redrive-fullscope-19b26510",
      "  - commit: abc150",
      "  - push: 成功",
      "  - push_error: 无",
      "- 备注: stale response",
    ].join("\n");
    const finalReportText = [
      "## 任务完成",
      "- 结果: 成功",
      "- 任务ID: dispatch-151:redrive-b5240295",
      "- 修改文件: apps/dispatcher/src/modules/server/dispatcher-server.ts",
      "- 测试结果: pnpm test",
      "- 风险: 无",
      "- GitHub 证据:",
      "  - branch: ai/trae/harden-dispatcher-auth-defaults-20260404-redrive-fullscope-retry-b5240295",
      "  - commit: abc151",
      "  - push: 成功",
      "  - push_error: 无",
      "- 备注: current response",
    ].join("\n");
    let responsePollIndex = 0;
    const responseSnapshots = [
      [{ index: 0, text: staleReportText, descriptor: {} }],
      [{ index: 0, text: staleReportText, descriptor: {} }],
      [{ index: 0, text: finalReportText, descriptor: {} }],
      [{ index: 0, text: finalReportText, descriptor: {} }],
    ];
    const captureResponseSnapshot = vi.fn(async () => {
      const next = responseSnapshots[Math.min(responsePollIndex, responseSnapshots.length - 1)];
      responsePollIndex += 1;
      return next;
    });
    const submitPrompt = vi.fn(async () => ({ ok: true }));
    const domAdapter = {
      inspectReadiness,
      prepareSession,
      captureResponseSnapshot,
      submitPrompt,
    };
    let nowValue = 0;

    const { createTraeAutomationDriver } = await import("../../src/runtime/trae-dom-driver.js");
    const driver = createTraeAutomationDriver({
      discoverTarget,
      connectToTarget,
      domAdapter: domAdapter as never,
      now: () => {
        nowValue += 700;
        return nowValue;
      },
      responsePollIntervalMs: 0,
      responseIdleMs: 600,
      responseTimeoutMs: 5000,
      postActionDelayMs: 0,
    });

    await expect(driver.sendPrompt({
      content: "Please continue the task",
      prepare: true,
      responseRequiredPrefix: "任务完成",
      expectedTaskId: "dispatch-151:redrive-b5240295",
    })).resolves.toMatchObject({
      status: "ok",
      response: {
        text: finalReportText,
      },
    });
  });

  it("limits new_chat snapshots to the last visible chat root when collecting baseline and responses", async () => {
    const discoverTarget = vi.fn(async () => ({
      target: {
        id: "target-1",
        title: "ForgeFlow — new chat root limit",
        url: "vscode-file://workbench",
      },
      version: {},
      targets: [],
    }));
    const session = {
      close: vi.fn(async () => undefined),
    };
    const connectToTarget = vi.fn(async () => session);
    const inspectReadiness = vi.fn(async () => ({
      ready: true,
      title: "ForgeFlow — new chat root limit",
      url: "vscode-file://workbench",
      composerFound: true,
      composerSelector: ".chat-input-v2-input-box-editable",
      sendButtonFound: true,
      sendButtonSelector: "button.chat-input-v2-send-button",
      newChatFound: true,
      responseFound: false,
      readyState: "complete",
    }));
    const prepareSession = vi.fn(async () => ({ ok: true, clicked: true }));
    const finalReportText = [
      "## 任务完成",
      "- 结果: 成功",
      "- 任务ID: dispatch-190:new-chat-root",
    ].join("\n");
    let responsePollIndex = 0;
    const captureResponseSnapshot = vi.fn(async (_session, _config, options) => {
      if (Array.isArray(options?.selectors)) {
        return [];
      }
      const snapshots = [
        [],
        [{ index: 0, text: finalReportText, descriptor: {} }],
        [{ index: 0, text: finalReportText, descriptor: {} }],
      ];
      const next = snapshots[Math.min(responsePollIndex, snapshots.length - 1)];
      responsePollIndex += 1;
      return next;
    });
    const submitPrompt = vi.fn(async () => ({ ok: true }));
    const domAdapter = {
      inspectReadiness,
      prepareSession,
      captureResponseSnapshot,
      submitPrompt,
    };
    let nowValue = 0;

    const { createTraeAutomationDriver } = await import("../../src/runtime/trae-dom-driver.js");
    const driver = createTraeAutomationDriver({
      discoverTarget,
      connectToTarget,
      domAdapter: domAdapter as never,
      now: () => {
        nowValue += 700;
        return nowValue;
      },
      responsePollIntervalMs: 0,
      responseIdleMs: 600,
      responseTimeoutMs: 5000,
      postActionDelayMs: 0,
    });

    await expect(driver.sendPrompt({
      content: "Please start a fresh task",
      prepare: true,
      chatMode: "new_chat",
      expectedTaskId: "dispatch-190:new-chat-root",
      responseRequiredPrefix: "任务完成",
    })).resolves.toMatchObject({
      status: "ok",
      response: {
        text: finalReportText,
      },
    });

    expect(captureResponseSnapshot).toHaveBeenCalledWith(
      session,
      expect.any(Object),
      expect.objectContaining({
        rootSelectors: expect.any(Array),
        rootPick: "last",
      }),
    );
  });

  it("fails fast when new_chat baseline still contains a different completed task id", async () => {
    const discoverTarget = vi.fn(async () => ({
      target: {
        id: "target-1",
        title: "ForgeFlow — stale baseline",
        url: "vscode-file://workbench",
      },
      version: {},
      targets: [],
    }));
    const session = {
      close: vi.fn(async () => undefined),
    };
    const connectToTarget = vi.fn(async () => session);
    const inspectReadiness = vi.fn(async () => ({
      ready: true,
      title: "ForgeFlow — stale baseline",
      url: "vscode-file://workbench",
      composerFound: true,
      composerSelector: ".chat-input-v2-input-box-editable",
      sendButtonFound: true,
      sendButtonSelector: "button.chat-input-v2-send-button",
      newChatFound: true,
      responseFound: true,
      readyState: "complete",
    }));
    const prepareSession = vi.fn(async () => ({ ok: true, clicked: true }));
    const staleReportText = [
      "## 任务完成",
      "- 结果: 成功",
      "- 任务ID: dispatch-186:old-task",
      "- 修改文件: 无",
    ].join("\n");
    const captureResponseSnapshot = vi.fn(async (_session, _config, options) => {
      if (Array.isArray(options?.selectors)) {
        return [];
      }
      return [{ index: 0, text: staleReportText, descriptor: {} }];
    });
    const submitPrompt = vi.fn(async () => ({ ok: true }));
    const domAdapter = {
      inspectReadiness,
      prepareSession,
      captureResponseSnapshot,
      submitPrompt,
    };

    const { createTraeAutomationDriver } = await import("../../src/runtime/trae-dom-driver.js");
    const driver = createTraeAutomationDriver({
      discoverTarget,
      connectToTarget,
      domAdapter: domAdapter as never,
      responsePollIntervalMs: 0,
      responseIdleMs: 600,
      responseTimeoutMs: 5000,
      postActionDelayMs: 0,
    });

    await expect(driver.sendPrompt({
      content: "Please start a fresh task",
      prepare: true,
      chatMode: "new_chat",
      expectedTaskId: "dispatch-187:new-task",
      responseRequiredPrefix: "任务完成",
    })).rejects.toThrow('Prepared new chat but still reading stale task content for "dispatch-186:old-task"');

    expect(submitPrompt).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalledTimes(1);
  });
});
