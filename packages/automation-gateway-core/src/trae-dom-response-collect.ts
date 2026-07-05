// @ts-nocheck
import { getLastReportFieldValue, isEquivalentReportedTaskId, looksLikeTemplatePlaceholderReport } from "./report.js";
import { sleep } from "./trae-dom-driver-config.js";
import { extractAutomationResponse } from "./trae-dom-response-extract.js";
import { buildActivityState, shouldPreferActivityText } from "./trae-dom-response-activity.js";
import { TraeAutomationError } from "./trae-automation-errors.js";

function normalizePrefixComparableText(value) {
  return String(value || "")
    .trimStart()
    .replace(/^#+\s*/, "");
}

function createCollectionState(now, baselineSnapshot) {
  const startedAt = now();
  return {
    startedAt,
    lastMeaningfulText: "",
    lastResponseCanFinish: false,
    lastActivitySource: "activity",
    lastActivitySnapshotCount: 0,
    lastChangeAt: startedAt,
    finalSnapshot: baselineSnapshot,
  };
}

function buildRootSnapshotOptions(config) {
  const selectors = Array.isArray(config.snapshotRootSelectors) ? config.snapshotRootSelectors : [];
  if (selectors.length === 0) {
    return undefined;
  }
  return {
    rootSelectors: selectors,
    rootPick: String(config.snapshotRootPick || "first"),
  };
}

async function extractResponseCandidate(params) {
  const { domAdapter, session, config, baselineSnapshot, baselineActivitySnapshot, prompt, rootOptions } = params;
  const snapshot = await domAdapter.captureResponseSnapshot(session, config, rootOptions);
  const extracted = extractAutomationResponse(snapshot, baselineSnapshot, {
    requiredPrefix: params.requiredPrefix,
  });
  const candidate = {
    snapshot,
    text: extracted.text || "",
    source: extracted.source,
    snapshotCount: extracted.snapshotCount,
    canFinish: Boolean(extracted.text),
  };
  return applyActivityCandidate({
    ...params,
    candidate,
    baselineActivitySnapshot,
    prompt,
    rootOptions,
  });
}

async function applyActivityCandidate(params) {
  const { domAdapter, session, config, baselineActivitySnapshot, prompt, rootOptions, candidate } = params;
  if (!Array.isArray(config.activitySelectors) || config.activitySelectors.length === 0) {
    return candidate;
  }
  const activitySnapshot = await domAdapter.captureResponseSnapshot(session, config, {
    selectors: config.activitySelectors,
    allowHiddenText: true,
    ...(rootOptions || {}),
  });
  const extractedActivity = extractAutomationResponse(activitySnapshot, baselineActivitySnapshot, {
    requiredPrefix: params.requiredPrefix,
  });
  const activityState = buildActivityState(extractedActivity.text, prompt);
  if (!activityState.meaningful || !shouldPreferActivityText(candidate.text, activityState)) {
    return candidate;
  }
  return {
    ...candidate,
    text: activityState.text,
    source: `activity_${extractedActivity.source}`,
    snapshotCount: extractedActivity.snapshotCount,
    canFinish: !activityState.pending || activityState.terminal,
  };
}

function applyCompletionGuards(candidate, config) {
  const guarded = { ...candidate };
  if (guarded.text && !config.allowPlainTextResponse && looksLikeTemplatePlaceholderReport(guarded.text)) {
    guarded.canFinish = false;
  }
  if (guarded.text && config.expectedTaskId) {
    const reportedTaskId = getLastReportFieldValue(guarded.text, "任务ID");
    if (reportedTaskId && !isEquivalentReportedTaskId(config.expectedTaskId, reportedTaskId)) {
      guarded.canFinish = false;
    }
  }
  return guarded;
}

function updateCollectionState(state, candidate, now, debugLog) {
  const changed = candidate.text
    && (candidate.text !== state.lastMeaningfulText || candidate.canFinish !== state.lastResponseCanFinish);
  if (!changed) {
    return;
  }
  state.lastMeaningfulText = candidate.text;
  state.lastResponseCanFinish = candidate.canFinish;
  state.lastChangeAt = now();
  debugLog("response changed", {
    source: candidate.source,
    snapshotCount: candidate.snapshotCount,
    canFinish: candidate.canFinish,
    preview: state.lastMeaningfulText.slice(0, 200),
  });
}

function canAcceptResponse(state, candidate, requiredPrefix, config, now) {
  const normalizedRequiredPrefix = normalizePrefixComparableText(requiredPrefix);
  const matchesRequiredPrefix = !requiredPrefix
    || normalizePrefixComparableText(state.lastMeaningfulText).startsWith(normalizedRequiredPrefix);
  return state.lastMeaningfulText
    && matchesRequiredPrefix
    && state.lastResponseCanFinish
    && now() - state.lastChangeAt >= config.responseIdleMs
    ? {
      response: { text: state.lastMeaningfulText, source: candidate.source },
      snapshot: state.finalSnapshot,
    }
    : null;
}

function buildTimeoutDetails(state, requiredPrefix, config) {
  return {
    finalSnapshotCount: Array.isArray(state.finalSnapshot) ? state.finalSnapshot.length : 0,
    finalPreview: Array.isArray(state.finalSnapshot)
      ? state.finalSnapshot.map((entry) => String(entry?.text || "").slice(0, 160))
      : [],
    lastMeaningfulPreview: state.lastMeaningfulText.slice(0, 200),
    requiredPrefix,
    timeoutMs: config.responseTimeoutMs,
  };
}

export async function collectAutomationResponse({
  domAdapter,
  session,
  config,
  baselineSnapshot,
  baselineActivitySnapshot = [],
  prompt = "",
  now = Date.now,
  debugLog = () => {},
}) {
  const state = createCollectionState(now, baselineSnapshot);
  const requiredPrefix = String(config.responseRequiredPrefix || "").trim();
  const expectedTaskId = String(config.expectedTaskId || "").trim();
  const rootOptions = buildRootSnapshotOptions(config);

  debugLog("response collection started", {
    baselineCount: Array.isArray(baselineSnapshot) ? baselineSnapshot.length : 0,
    requiredPrefix,
    responseTimeoutMs: config.responseTimeoutMs,
    responseIdleMs: config.responseIdleMs,
  });

  while (now() - state.startedAt < config.responseTimeoutMs) {
    const candidate = applyCompletionGuards(await extractResponseCandidate({
      domAdapter,
      session,
      config: { ...config, expectedTaskId },
      baselineSnapshot,
      baselineActivitySnapshot,
      prompt,
      requiredPrefix,
      rootOptions,
    }), { ...config, expectedTaskId });
    state.finalSnapshot = candidate.snapshot;
    updateCollectionState(state, candidate, now, debugLog);

    const accepted = canAcceptResponse(state, candidate, requiredPrefix, config, now);
    if (accepted) {
      debugLog("response accepted", {
        source: candidate.source,
        snapshotCount: candidate.snapshotCount,
        preview: state.lastMeaningfulText.slice(0, 200),
      });
      return accepted;
    }

    await sleep(config.responsePollIntervalMs);
  }

  debugLog("response timeout", buildTimeoutDetails(state, requiredPrefix, config));
  throw new TraeAutomationError("AUTOMATION_RESPONSE_TIMEOUT", "Timed out waiting for Trae to finish responding", {
    timeoutMs: config.responseTimeoutMs,
  });
}
