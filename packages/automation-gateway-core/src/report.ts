export function getLastReportFieldValue(text: string, fieldName: string) {
  let value = "";
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const match = line.match(/^\s*(?:-\s*)?([^:]+):\s*(.*)$/);
    if (!match) {
      continue;
    }
    if (match[1].trim() === fieldName) {
      value = match[2].trim();
    }
  }
  return value;
}

export function isPlaceholderTaskId(taskId: string) {
  return /^<[^>]+>$/.test(String(taskId || "").trim());
}

export function isEquivalentReportedTaskId(expectedTaskId: string, reportedTaskId: string) {
  const expected = String(expectedTaskId || "").trim();
  const reported = String(reportedTaskId || "").trim();
  if (!expected || !reported) {
    return false;
  }

  if (expected === reported) {
    return true;
  }

  if (isPlaceholderTaskId(reported)) {
    return false;
  }

  if (/^dispatch-\d+:.+/.test(expected) && reported === expected.replace(":", "-")) {
    return true;
  }

  const expectedDispatchPrefix = expected.match(/^(dispatch-\d+):/);
  if (expectedDispatchPrefix && reported === expectedDispatchPrefix[1]) {
    return true;
  }

  return false;
}

export function looksLikeTemplatePlaceholderReport(text: string) {
  const result = getLastReportFieldValue(text, "结果");
  const taskId = getLastReportFieldValue(text, "任务ID");
  if (!result || !taskId) {
    return true;
  }
  if (isPlaceholderTaskId(taskId)) {
    return true;
  }
  if (result === "成功 / 失败") {
    return true;
  }
  return false;
}
