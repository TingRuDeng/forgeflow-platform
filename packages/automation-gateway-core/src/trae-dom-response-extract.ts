// @ts-nocheck
export interface SnapshotEntry {
  index: number;
  text: string;
  descriptor: unknown;
}

export interface ExtractAutomationResponseOptions {
  requiredPrefix?: string;
}

export interface ExtractAutomationResponseResult {
  text: string;
  source: string;
  snapshotCount: number;
}

export function extractAutomationResponse(
  snapshot: SnapshotEntry[] = [],
  baseline: SnapshotEntry[] = [],
  options: ExtractAutomationResponseOptions = {}
): ExtractAutomationResponseResult {
  const normalizePrefixComparableText = (value) => String(value || "")
    .trimStart()
    .replace(/^#+\s*/, "");

  const isLikelyPlannerText = (value) => {
    const normalized = String(value || "").trim();
    if (!normalized) {
      return false;
    }
    return normalized.startsWith("SOLO Coder")
      || normalized.includes("\n思考过程")
      || normalized.includes("思考过程\n");
  };

  const pickBestText = (texts, requiredPrefix = "") => {
    const candidates = Array.isArray(texts) ? texts.filter(Boolean) : [];
    if (candidates.length === 0) {
      return "";
    }

    const normalizedRequiredPrefix = normalizePrefixComparableText(requiredPrefix);
    const prefixed = normalizedRequiredPrefix
      ? candidates.filter((candidate) => normalizePrefixComparableText(candidate).startsWith(normalizedRequiredPrefix))
      : [];
    if (prefixed.length > 0) {
      return prefixed[prefixed.length - 1];
    }

    const nonPlanner = candidates.filter((candidate) => !isLikelyPlannerText(candidate));
    if (nonPlanner.length > 0) {
      return nonPlanner[nonPlanner.length - 1];
    }

    return candidates[candidates.length - 1];
  };

  const normalizeResponseText = (value) => {
    const lines = String(value || "")
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => line.trim());

    const headingIndex = lines.findIndex((line) => line.trim() === "任务完成" || line.trim() === "## 任务完成");
    const normalizedLines = headingIndex >= 0 ? lines.slice(headingIndex) : lines;

    while (normalizedLines.length > 1 && /^\d+%$/.test(normalizedLines[normalizedLines.length - 1].trim())) {
      normalizedLines.pop();
    }
    while (normalizedLines.length > 1 && normalizedLines[normalizedLines.length - 1].trim() === "任务完成") {
      normalizedLines.pop();
    }

    return normalizedLines.join("\n").trim();
  };

  const requiredPrefix = options.requiredPrefix || "";
  const currentTexts = Array.isArray(snapshot)
    ? snapshot.map((entry) => normalizeResponseText(entry.text || "")).filter(Boolean)
    : [];
  const baselineTexts = Array.isArray(baseline)
    ? baseline.map((entry) => normalizeResponseText(entry.text || "")).filter(Boolean)
    : [];

  if (currentTexts.length === 0) {
    return { text: "", source: "empty", snapshotCount: 0 };
  }
  if (currentTexts.length > baselineTexts.length) {
    const newTexts = currentTexts.slice(baselineTexts.length);
    return {
      text: pickBestText(newTexts, requiredPrefix),
      source: "new_nodes",
      snapshotCount: currentTexts.length,
    };
  }

  const currentLast = currentTexts[currentTexts.length - 1];
  const baselineLast = baselineTexts[baselineTexts.length - 1] || "";
  if (baselineLast && currentLast.startsWith(baselineLast) && currentLast.length > baselineLast.length) {
    return {
      text: pickBestText([currentLast.slice(baselineLast.length)], requiredPrefix),
      source: "last_node_growth",
      snapshotCount: currentTexts.length,
    };
  }

  if (baselineLast && currentTexts.length === baselineTexts.length && currentLast !== baselineLast) {
    const replacedText = pickBestText([currentLast], requiredPrefix);
    if (replacedText) {
      return {
        text: replacedText,
        source: "last_node_replaced",
        snapshotCount: currentTexts.length,
      };
    }
  }

  return {
    text: "",
    source: "stale_baseline",
    snapshotCount: currentTexts.length,
  };
}
