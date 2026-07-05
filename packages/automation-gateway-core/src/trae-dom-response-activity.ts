// @ts-nocheck
import { getLastReportFieldValue, isEquivalentReportedTaskId } from "./report.js";
export function createDebugLogger(config = {}, logger = console) {
  return (message, details = {}) => {
    if (!config.debug) {
      return;
    }
    logger?.warn?.(`[trae-automation-debug] ${message} ${JSON.stringify(details)}`);
  };
}

function sanitizeActivityText(text = "", prompt = "") {
  let sanitized = String(text || "");
  const normalizedPrompt = String(prompt || "").trim();

  if (normalizedPrompt) {
    const lastPromptIndex = sanitized.lastIndexOf(normalizedPrompt);
    if (lastPromptIndex >= 0) {
      sanitized = sanitized.slice(lastPromptIndex + normalizedPrompt.length);
    }
  }

  return sanitized
    .split(/\r?\n/)
    .map((line) => line
      .replace(/\b\d{1,2}:\d{2}\b/g, " ")
      .replace(/Builder/g, " ")
      .replace(/正在分析问题\.{0,3}/gu, " ")
      .replace(/思考中\.{0,3}/gu, " ")
      .replace(/思考过程/gu, " ")
      .replace(/任务完成\s*\d+%/gu, " ")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[ \t]+/g, " ")
      .trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function normalizeComparableText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function isPlaceholderTaskId(taskId) {
  return /^<[^>]+>$/.test(String(taskId || "").trim());
}

export function detectMismatchedTaskId(snapshot = [], expectedTaskId = "") {
  const expected = String(expectedTaskId || "").trim();
  if (!expected || !Array.isArray(snapshot)) {
    return null;
  }

  for (const entry of snapshot) {
    const text = String(entry?.text || "").trim();
    if (!text) {
      continue;
    }
    const reportedTaskId = getLastReportFieldValue(text, "任务ID");
    if (!reportedTaskId || isPlaceholderTaskId(reportedTaskId)) {
      continue;
    }
    if (!isEquivalentReportedTaskId(expected, reportedTaskId)) {
      return {
        taskId: reportedTaskId,
        preview: text.slice(0, 200),
      };
    }
  }

  return null;
}

export function buildActivityState(text, prompt) {
  const rawText = String(text || "");
  const sanitizedText = sanitizeActivityText(rawText, prompt);
  return {
    rawText,
    text: sanitizedText,
    meaningful: Boolean(normalizeComparableText(sanitizedText)),
    pending: /(?:正在分析问题|思考中|思考过程)/u.test(rawText),
    terminal: /(?:任务完成|请求失败|失败|异常打断|错误|error)/iu.test(rawText),
  };
}

export function shouldPreferActivityText(finalText, activityState) {
  const normalizedFinal = normalizeComparableText(finalText);
  const normalizedActivity = normalizeComparableText(activityState?.text || "");
  if (!normalizedActivity) {
    return false;
  }
  if (!normalizedFinal) {
    return true;
  }
  if (normalizedActivity === normalizedFinal) {
    return false;
  }
  if (normalizedActivity.includes(normalizedFinal) && normalizedActivity.length > normalizedFinal.length) {
    return true;
  }
  return normalizedActivity.length >= normalizedFinal.length + 12;
}
