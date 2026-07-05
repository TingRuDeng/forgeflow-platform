// @ts-nocheck
import { createCDPSession } from "./trae-cdp-client.js";
import { discoverTraeTarget } from "./trae-cdp-discovery.js";
import { buildDriverConfig, sleep } from "./trae-dom-driver-config.js";
import { createBrowserDomAdapter, normalizeReadiness } from "./trae-dom-expressions.js";
import { collectAutomationResponse, createDebugLogger, detectMismatchedTaskId } from "./trae-dom-response.js";
import { TraeAutomationError, normalizeAutomationError } from "./trae-automation-errors.js";

export function createDriverRuntime(options = {}) {
  const config = buildDriverConfig(options);
  const connectToTarget = options.connectToTarget || ((target) => createCDPSession({
    webSocketDebuggerUrl: target.webSocketDebuggerUrl,
    commandTimeoutMs: config.commandTimeoutMs,
    WebSocket: options.WebSocket,
  }));
  return {
    config,
    discoverTarget: options.discoverTarget || discoverTraeTarget,
    connectToTarget,
    domAdapter: options.domAdapter || createBrowserDomAdapter(),
    now: typeof options.now === "function" ? options.now : Date.now,
    debugLog: createDebugLogger(config, options.logger || console),
  };
}

function resolveDiscoveryOptions(config, override = {}) {
  return {
    ...config.discovery,
    ...(override || {}),
  };
}

function summarizeTarget(target) {
  return {
    id: target.id,
    title: target.title,
    url: target.url,
  };
}

function summarizeSelectors(config) {
  return {
    composerSelectors: config.composerSelectors,
    sendButtonSelectors: config.sendButtonSelectors,
    responseSelectors: config.responseSelectors,
    newChatSelectors: config.newChatSelectors,
  };
}

async function closeSession(session) {
  if (session) {
    await session.close().catch(() => {});
  }
}

async function waitPostAction(config) {
  if (config.postActionDelayMs > 0) {
    await sleep(config.postActionDelayMs);
  }
}

async function openTargetSession(runtime, discoveryOverride) {
  const discovery = await runtime.discoverTarget(resolveDiscoveryOptions(runtime.config, discoveryOverride));
  const session = await runtime.connectToTarget(discovery.target, runtime.config);
  return { discovery, session };
}

export async function getDriverReadiness(runtime, payload = {}) {
  let session = null;
  try {
    const opened = await openTargetSession(runtime, payload.discovery);
    session = opened.session;
    const readiness = normalizeReadiness(
      await runtime.domAdapter.inspectReadiness(session, runtime.config),
      opened.discovery.target,
    );
    return {
      ready: Boolean(readiness?.ready),
      mode: "cdp",
      target: summarizeTarget(opened.discovery.target),
      selectors: summarizeSelectors(runtime.config),
      details: readiness || null,
    };
  } catch (error) {
    return {
      ready: false,
      mode: "cdp",
      selectors: summarizeSelectors(runtime.config),
      error: normalizeAutomationError(error, "AUTOMATION_NOT_READY", "Trae automation is not ready"),
    };
  } finally {
    await closeSession(session);
  }
}

async function attachPrepareDiagnostics(runtime, normalizedError, discovery, session) {
  if (!discovery?.target || !session) {
    return normalizedError;
  }

  const target = summarizeTarget(discovery.target);
  try {
    const readiness = await runtime.domAdapter.inspectReadiness(session, runtime.config);
    normalizedError.details = {
      ...normalizedError.details,
      target,
      diagnostics: {
        title: readiness?.title || null,
        url: readiness?.url || null,
        composerFound: Boolean(readiness?.composerFound),
        composerSelector: readiness?.composerSelector || null,
        sendButtonFound: Boolean(readiness?.sendButtonFound),
        sendButtonSelector: readiness?.sendButtonSelector || null,
        readyState: readiness?.readyState || null,
      },
    };
  } catch (diagnosticError) {
    normalizedError.details = {
      ...normalizedError.details,
      target,
      diagnostics: {
        title: discovery.target.title,
        url: discovery.target.url,
        composerFound: null,
        composerSelector: null,
        sendButtonFound: null,
        sendButtonSelector: null,
        readyState: null,
        diagnosticError: diagnosticError?.message || "Failed to collect diagnostics",
      },
    };
  }
  return normalizedError;
}

export async function prepareDriverSession(runtime, payload = {}) {
  let session = null;
  let discovery = null;
  try {
    const opened = await openTargetSession(runtime, payload.discovery);
    discovery = opened.discovery;
    session = opened.session;
    const preparation = await runtime.domAdapter.prepareSession(session, runtime.config, payload);
    if (!preparation?.ok) {
      throw new TraeAutomationError("AUTOMATION_PREPARE_FAILED", "Failed to prepare a fresh Trae conversation", {
        preparation,
      });
    }

    await waitPostAction(runtime.config);
    return {
      status: "ok",
      preparation,
      target: summarizeTarget(discovery.target),
    };
  } catch (error) {
    const normalized = normalizeAutomationError(error, "AUTOMATION_PREPARE_FAILED", "Trae automation prepare session failed");
    throw await attachPrepareDiagnostics(runtime, normalized, discovery, session);
  } finally {
    await closeSession(session);
  }
}

async function assertReady(runtime, session, target) {
  const readiness = normalizeReadiness(await runtime.domAdapter.inspectReadiness(session, runtime.config), target);
  if (!readiness?.ready) {
    throw new TraeAutomationError("AUTOMATION_SELECTOR_NOT_READY", "The Trae window is missing the configured selectors", {
      readiness,
    });
  }
}

async function preparePromptConversation(runtime, session, payload) {
  if (payload.prepare === false) {
    return;
  }
  const preparation = await runtime.domAdapter.prepareSession(session, runtime.config, payload);
  if (!preparation?.ok) {
    throw new TraeAutomationError("AUTOMATION_PREPARE_FAILED", "Failed to prepare a fresh Trae conversation", {
      preparation,
    });
  }
  await waitPostAction(runtime.config);
}

async function captureBaselineSnapshots(runtime, session, payload) {
  const snapshotRootSelectors = payload.chatMode === "new_chat" && Array.isArray(runtime.config.activitySelectors)
    ? [...runtime.config.activitySelectors]
    : [];
  const snapshotRootPick = "last";
  const rootOptions = snapshotRootSelectors.length > 0
    ? { rootSelectors: snapshotRootSelectors, rootPick: snapshotRootPick }
    : undefined;
  const baselineSnapshot = await runtime.domAdapter.captureResponseSnapshot(session, runtime.config, rootOptions);
  const baselineActivitySnapshot = Array.isArray(runtime.config.activitySelectors) && runtime.config.activitySelectors.length > 0
    ? await runtime.domAdapter.captureResponseSnapshot(session, runtime.config, {
      selectors: runtime.config.activitySelectors,
      allowHiddenText: true,
      ...(rootOptions || {}),
    })
    : [];
  return { baselineSnapshot, baselineActivitySnapshot, snapshotRootSelectors, snapshotRootPick };
}

function assertFreshNewChatBaseline(payload, baselineSnapshot, baselineActivitySnapshot) {
  if (payload.chatMode !== "new_chat") {
    return;
  }
  const staleBaselineMatch = detectMismatchedTaskId(
    [...baselineSnapshot, ...baselineActivitySnapshot],
    payload.expectedTaskId ?? null,
  );
  if (staleBaselineMatch) {
    throw new TraeAutomationError("AUTOMATION_PREPARE_STALE_SESSION", `Prepared new chat but still reading stale task content for "${staleBaselineMatch.taskId}"`, {
      staleTaskId: staleBaselineMatch.taskId,
      stalePreview: staleBaselineMatch.preview,
    });
  }
}

async function submitPromptAndCollect(runtime, session, payload, baseline) {
  const submitResult = await runtime.domAdapter.submitPrompt(session, runtime.config, payload);
  if (!submitResult?.ok) {
    throw new TraeAutomationError("AUTOMATION_SUBMIT_FAILED", "Failed to submit text through the Trae window", {
      submitResult,
    });
  }

  await waitPostAction(runtime.config);
  const collected = await collectAutomationResponse({
    domAdapter: runtime.domAdapter,
    session,
    config: {
      ...runtime.config,
      expectedTaskId: payload.expectedTaskId ?? null,
      responseRequiredPrefix: payload.responseRequiredPrefix ?? runtime.config.responseRequiredPrefix,
      responseTimeoutMs: Number(payload.responseTimeoutMs || runtime.config.responseTimeoutMs),
      snapshotRootSelectors: baseline.snapshotRootSelectors,
      snapshotRootPick: baseline.snapshotRootPick,
    },
    baselineSnapshot: baseline.baselineSnapshot,
    baselineActivitySnapshot: baseline.baselineActivitySnapshot,
    prompt: payload.content,
    now: runtime.now,
    debugLog: runtime.debugLog,
  });
  return { submitResult, collected };
}

export async function sendDriverPrompt(runtime, payload = {}) {
  let session = null;
  try {
    const opened = await openTargetSession(runtime, payload.discovery);
    session = opened.session;
    await assertReady(runtime, session, opened.discovery.target);
    await preparePromptConversation(runtime, session, payload);
    const baseline = await captureBaselineSnapshots(runtime, session, payload);
    assertFreshNewChatBaseline(payload, baseline.baselineSnapshot, baseline.baselineActivitySnapshot);
    runtime.debugLog("prompt submitted", {
      targetTitle: opened.discovery.target.title,
      baselineCount: Array.isArray(baseline.baselineSnapshot) ? baseline.baselineSnapshot.length : 0,
      baselineActivityCount: Array.isArray(baseline.baselineActivitySnapshot) ? baseline.baselineActivitySnapshot.length : 0,
      requiredPrefix: payload.responseRequiredPrefix ?? runtime.config.responseRequiredPrefix ?? null,
    });
    const { submitResult, collected } = await submitPromptAndCollect(runtime, session, payload, baseline);
    return {
      status: "ok",
      response: collected.response,
      submitResult,
      target: summarizeTarget(opened.discovery.target),
    };
  } catch (error) {
    throw normalizeAutomationError(error, "AUTOMATION_REQUEST_FAILED", "Trae automation request failed");
  } finally {
    await closeSession(session);
  }
}
