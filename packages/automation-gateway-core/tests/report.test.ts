import { describe, expect, it } from "vitest";

import {
  getLastReportFieldValue,
  isEquivalentReportedTaskId,
  isPlaceholderTaskId,
  looksLikeTemplatePlaceholderReport,
} from "../src/index.js";

describe("automation-gateway-core/report", () => {
  it("returns the last matching field value from a final report", () => {
    const value = getLastReportFieldValue([
      "- 结果: 失败",
      "- 任务ID: dispatch-160:redrive-e46a3853",
      "- 结果: 成功",
    ].join("\n"), "结果");

    expect(value).toBe("成功");
  });

  it("accepts the narrow task-id variants emitted by Trae completions", () => {
    expect(isEquivalentReportedTaskId("dispatch-160:redrive-e46a3853", "dispatch-160:redrive-e46a3853")).toBe(true);
    expect(isEquivalentReportedTaskId("dispatch-160:redrive-e46a3853", "dispatch-160-redrive-e46a3853")).toBe(true);
    expect(isEquivalentReportedTaskId("dispatch-160:redrive-e46a3853", "dispatch-160")).toBe(true);
  });

  it("rejects placeholder and unrelated task ids", () => {
    expect(isPlaceholderTaskId("<task_id>")).toBe(true);
    expect(isEquivalentReportedTaskId("dispatch-160:redrive-e46a3853", "<task_id>")).toBe(false);
    expect(isEquivalentReportedTaskId("dispatch-160:redrive-e46a3853", "dispatch-159:redrive-other")).toBe(false);
  });

  it("detects template placeholder reports", () => {
    expect(looksLikeTemplatePlaceholderReport([
      "## 任务完成",
      "- 结果: 成功 / 失败",
      "- 任务ID: <task_id>",
    ].join("\n"))).toBe(true);

    expect(looksLikeTemplatePlaceholderReport([
      "## 任务完成",
      "- 结果: 成功",
      "- 任务ID: dispatch-160:redrive-e46a3853",
    ].join("\n"))).toBe(false);
  });
});
