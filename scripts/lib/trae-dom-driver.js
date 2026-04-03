import { createCDPSession } from "./trae-cdp-client.js";
import { discoverTraeTarget } from "./trae-cdp-discovery.js";
import { TraeAutomationError, normalizeAutomationError } from "./trae-automation-errors.js";
export const DEFAULT_COMPOSER_SELECTORS = [
    ".chat-input-v2-input-box-editable",
    "textarea",
    "[contenteditable='true']",
    "input[type='text']",
];
export const DEFAULT_SEND_BUTTON_SELECTORS = [
    "button.chat-input-v2-send-button",
    "button[data-testid*='send']",
    "button[aria-label*='Send']",
    "button[type='submit']",
];
export const DEFAULT_RESPONSE_SELECTORS = [
    ".assistant-chat-turn-content",
    "[data-message-author-role='assistant']",
    "[data-testid*='assistant']",
    "[data-role='assistant']",
    "[data-author='assistant']",
    ".assistant",
];
export const DEFAULT_NEW_CHAT_SELECTORS = ["a.codicon-icube-NewChat", "button[aria-label*='New Chat']"];
export const DEFAULT_RESPONSE_POLL_INTERVAL_MS = Number(process.env.TRAE_RESPONSE_POLL_INTERVAL_MS || 350);
export const DEFAULT_RESPONSE_IDLE_MS = Number(process.env.TRAE_RESPONSE_IDLE_MS || 1200);
export const DEFAULT_RESPONSE_TIMEOUT_MS = Number(process.env.TRAE_RESPONSE_TIMEOUT_MS || 30000);
export const DEFAULT_POST_ACTION_DELAY_MS = Number(process.env.TRAE_POST_ACTION_DELAY_MS || 350);
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function parseSelectorList(value, fallbackSelectors) {
    if (Array.isArray(value)) {
        const parsed = value.map((item) => String(item).trim()).filter(Boolean);
        return parsed.length > 0 ? parsed : [...fallbackSelectors];
    }
    const parsed = String(value || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    return parsed.length > 0 ? parsed : [...fallbackSelectors];
}
function firstDefined(...values) {
    for (const value of values) {
        if (value !== undefined && value !== null && value !== "") {
            return value;
        }
    }
    return undefined;
}
export function buildDriverConfig(options = {}) {
    return {
        discovery: {
            host: options.host,
            port: options.port,
            timeoutMs: options.discoveryTimeoutMs,
            titleContains: options.titleContains || process.env.TRAE_CDP_TARGET_TITLE_CONTAINS,
            urlContains: options.urlContains || process.env.TRAE_CDP_TARGET_URL_CONTAINS,
            targetType: options.targetType || process.env.TRAE_CDP_TARGET_TYPE,
            fetchImpl: options.fetchImpl,
        },
        composerSelectors: parseSelectorList(options.composerSelectors || process.env.TRAE_COMPOSER_SELECTORS, DEFAULT_COMPOSER_SELECTORS),
        sendButtonSelectors: parseSelectorList(options.sendButtonSelectors || process.env.TRAE_SEND_BUTTON_SELECTORS, DEFAULT_SEND_BUTTON_SELECTORS),
        responseSelectors: parseSelectorList(options.responseSelectors || process.env.TRAE_RESPONSE_SELECTORS, DEFAULT_RESPONSE_SELECTORS),
        newChatSelectors: parseSelectorList(options.newChatSelectors || process.env.TRAE_NEW_CHAT_SELECTORS, DEFAULT_NEW_CHAT_SELECTORS),
        responsePollIntervalMs: Number(firstDefined(options.responsePollIntervalMs, process.env.TRAE_RESPONSE_POLL_INTERVAL_MS, DEFAULT_RESPONSE_POLL_INTERVAL_MS)),
        responseIdleMs: Number(firstDefined(options.responseIdleMs, process.env.TRAE_RESPONSE_IDLE_MS, DEFAULT_RESPONSE_IDLE_MS)),
        responseTimeoutMs: Number(firstDefined(options.responseTimeoutMs, process.env.TRAE_RESPONSE_TIMEOUT_MS, DEFAULT_RESPONSE_TIMEOUT_MS)),
        postActionDelayMs: Number(firstDefined(options.postActionDelayMs, process.env.TRAE_POST_ACTION_DELAY_MS, DEFAULT_POST_ACTION_DELAY_MS)),
        commandTimeoutMs: Number(firstDefined(options.commandTimeoutMs, process.env.TRAE_CDP_COMMAND_TIMEOUT_MS, 5000)),
        responseRequiredPrefix: firstDefined(options.responseRequiredPrefix, process.env.TRAE_RESPONSE_REQUIRED_PREFIX),
        debug: firstDefined(options.debug, process.env.TRAE_AUTOMATION_DEBUG) === true
            || String(firstDefined(options.debug, process.env.TRAE_AUTOMATION_DEBUG) || "").trim() === "1",
    };
}
function serialize(value) {
    return JSON.stringify(value);
}
const BROWSER_HELPERS_SOURCE = `
function traeAutomationQueryAll(selectors) {
  const seen = new Set();
  const elements = [];
  for (const selector of selectors) {
    if (typeof selector !== "string" || !selector.trim()) {
      continue;
    }
    let matched = [];
    try {
      matched = Array.from(document.querySelectorAll(selector));
    } catch {
      continue;
    }
    for (const element of matched) {
      if (!seen.has(element)) {
        seen.add(element);
        elements.push(element);
      }
    }
  }
  return elements;
}

function traeAutomationIsVisible(element, options = {}) {
  if (!element || !(element instanceof Element)) {
    return false;
  }
  const style = window.getComputedStyle(element);
  if (!style || style.display === "none") {
    return false;
  }
  if (!options.allowHiddenText && style.visibility === "hidden") {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0;
}

function traeAutomationDescribeElement(element) {
  if (!element) {
    return null;
  }
  return {
    tagName: element.tagName ? element.tagName.toLowerCase() : null,
    id: element.id || null,
    className: typeof element.className === "string" ? element.className : null,
  };
}

function traeAutomationPickVisible(selectors, options = {}) {
  for (const selector of selectors) {
    if (typeof selector !== "string" || !selector.trim()) {
      continue;
    }
    let matched = [];
    try {
      matched = Array.from(document.querySelectorAll(selector)).filter((element) => traeAutomationIsVisible(element));
    } catch {
      continue;
    }
    if (matched.length > 0) {
      return options.pick === "last" ? matched[matched.length - 1] : matched[0];
    }
  }
  return null;
}

function traeAutomationGetText(element) {
  if (!element) {
    return "";
  }
  return String(element.innerText || element.textContent || "")
    .replace(/\\u00a0/g, " ")
    .replace(/\\r/g, "")
    .trim();
}

function traeAutomationFilterTopLevel(elements) {
  return elements.filter((element, index) => {
    return !elements.some((candidate, candidateIndex) => candidateIndex !== index && candidate.contains(element));
  });
}

function traeAutomationSnapshotResponses(selectors, options = {}) {
  return traeAutomationFilterTopLevel(
    traeAutomationQueryAll(selectors).filter((element) => traeAutomationIsVisible(element, options))
  )
    .map((element, index) => ({
      index,
      text: traeAutomationGetText(element),
      descriptor: traeAutomationDescribeElement(element),
    }))
    .filter((entry) => entry.text);
}

function traeAutomationSetValue(element, value) {
  if (!element) {
    return {
      ok: false,
      reason: "composer_missing",
    };
  }

  element.dispatchEvent(new MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true,
  }));
  if (typeof element.click === "function") {
    element.click();
  }
  element.focus();

  if (element.isContentEditable) {
    element.textContent = value;
    if (typeof InputEvent === "function") {
      element.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: value,
      }));
    } else {
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }
    return {
      ok: true,
      mode: "contenteditable",
    };
  }

  const prototype = element.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  if (descriptor && typeof descriptor.set === "function") {
    descriptor.set.call(element, value);
  } else {
    element.value = value;
  }
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  return {
    ok: true,
    mode: element.tagName ? element.tagName.toLowerCase() : "input",
  };
}

function traeAutomationSubmit(composer, sendButton) {
  if (sendButton) {
    sendButton.click();
    return {
      ok: true,
      trigger: "button",
    };
  }

  const keyboardEvent = {
    key: "Enter",
    code: "Enter",
    bubbles: true,
    cancelable: true,
  };
  composer.dispatchEvent(new KeyboardEvent("keydown", keyboardEvent));
  composer.dispatchEvent(new KeyboardEvent("keypress", keyboardEvent));
  composer.dispatchEvent(new KeyboardEvent("keyup", keyboardEvent));
  return {
    ok: true,
    trigger: "enter",
  };
}

function traeAutomationIsButtonDisabled(element) {
  if (!element) {
    return false;
  }
  if (element.disabled === true) {
    return true;
  }
  const ariaDisabled = element.getAttribute("aria-disabled");
  if (ariaDisabled === "true") {
    return true;
  }
  return typeof element.className === "string" && /(^|\\s)disabled(\\s|$)/.test(element.className);
}
`;
function buildFindFirstExpression(selectorsSource) {
    return `(() => {
    const selectors = ${selectorsSource};
    const findFirst = (list) => {
      for (const selector of list) {
        const node = document.querySelector(selector);
        if (node) return { node, selector };
      }
      return { node: null, selector: null };
    };
    return findFirst(selectors);
  })()`;
}
export function buildReadinessExpression(config) {
    return `(() => {
    ${BROWSER_HELPERS_SOURCE}
    const composerSelectors = ${serialize(config.composerSelectors)};
    const sendButtonSelectors = ${serialize(config.sendButtonSelectors)};
    const composer = traeAutomationPickVisible(composerSelectors);
    const sendButton = traeAutomationPickVisible(sendButtonSelectors);
    return {
      ready: Boolean(composer),
      title: document.title || "",
      url: location.href || "",
      composerFound: Boolean(composer),
      composerSelector: composer ? composerSelectors.find((selector) => {
        try {
          return Array.from(document.querySelectorAll(selector)).includes(composer);
        } catch {
          return false;
        }
      }) || null : null,
      sendButtonFound: Boolean(sendButton),
      sendButtonSelector: sendButton ? sendButtonSelectors.find((selector) => {
        try {
          return Array.from(document.querySelectorAll(selector)).includes(sendButton);
        } catch {
          return false;
        }
      }) || null : null
    };
  })()`;
}
export function buildPrepareSessionExpression(config) {
    return `(() => {
    ${BROWSER_HELPERS_SOURCE}
    const button = traeAutomationPickVisible(${serialize(config.newChatSelectors)});
    if (!button) {
      return { ok: true, clicked: false, skipped: true };
    }
    button.click();
    return {
      ok: true,
      clicked: true,
      trigger: "new_chat",
      button: traeAutomationDescribeElement(button)
    };
  })()`;
}
export function buildPrepareInputExpression(config) {
    return `(() => {
    ${BROWSER_HELPERS_SOURCE}
    const composer = traeAutomationPickVisible(${serialize(config.composerSelectors)});
    const sendButton = traeAutomationPickVisible(${serialize(config.sendButtonSelectors)});
    if (!composer) {
      return { ok: false, reason: "composer_missing" };
    }

    composer.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    }));
    if (typeof composer.click === "function") {
      composer.click();
    }
    composer.focus();

    if (composer.isContentEditable) {
      composer.textContent = "";
      if (typeof InputEvent === "function") {
        composer.dispatchEvent(new InputEvent("input", {
          bubbles: true,
          inputType: "deleteContentBackward",
          data: null,
        }));
      } else {
        composer.dispatchEvent(new Event("input", { bubbles: true }));
      }
    } else if (Object.prototype.hasOwnProperty.call(composer, "value")) {
      const prototype = composer.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
      if (descriptor && typeof descriptor.set === "function") {
        descriptor.set.call(composer, "");
      } else {
        composer.value = "";
      }
      composer.dispatchEvent(new Event("input", { bubbles: true }));
      composer.dispatchEvent(new Event("change", { bubbles: true }));
    }

    return {
      ok: true,
      isContentEditable: Boolean(composer.isContentEditable),
      tagName: composer.tagName ? composer.tagName.toLowerCase() : null,
      composer: traeAutomationDescribeElement(composer),
      sendButton: traeAutomationDescribeElement(sendButton),
    };
  })()`;
}
export function buildTriggerSubmitExpression(config) {
    return `(() => {
    ${BROWSER_HELPERS_SOURCE}
    const composer = traeAutomationPickVisible(${serialize(config.composerSelectors)});
    const sendButton = traeAutomationPickVisible(${serialize(config.sendButtonSelectors)});
    if (!composer) {
      return { ok: false, reason: "composer_missing" };
    }
    const submitResult = traeAutomationSubmit(composer, sendButton);
    return {
      ok: submitResult.ok,
      composer: traeAutomationDescribeElement(composer),
      sendButton: traeAutomationDescribeElement(sendButton),
      submitResult,
      composerText: traeAutomationGetText(composer),
      sendButtonDisabled: traeAutomationIsButtonDisabled(sendButton),
    };
  })()`;
}
export function buildSubmitExpression(config, payload = {}) {
    return `(() => {
    ${BROWSER_HELPERS_SOURCE}
    const composer = traeAutomationPickVisible(${serialize(config.composerSelectors)});
    const sendButton = traeAutomationPickVisible(${serialize(config.sendButtonSelectors)});
    const content = ${serialize(String(payload.content || ""))};
    const setValueResult = traeAutomationSetValue(composer, content);
    if (!setValueResult.ok) {
      return { ok: false, ...setValueResult };
    }
    const submitResult = traeAutomationSubmit(composer, sendButton);
    return {
      ok: submitResult.ok,
      composer: traeAutomationDescribeElement(composer),
      sendButton: traeAutomationDescribeElement(sendButton),
      setValueResult,
      submitResult
    };
  })()`;
}
export function buildCaptureExpression(config) {
    return `(() => {
    ${BROWSER_HELPERS_SOURCE}
    return traeAutomationSnapshotResponses(${serialize(config.responseSelectors)});
  })()`;
}
export function createBrowserDomAdapter() {
    return {
        async inspectReadiness(session, config) {
            return session.evaluate(buildReadinessExpression(config));
        },
        async prepareSession(session, config) {
            if (!config.newChatSelectors.length) {
                return { ok: true, clicked: false, skipped: true };
            }
            return session.evaluate(buildPrepareSessionExpression(config));
        },
        async submitPrompt(session, config, payload) {
            const prepared = await session.evaluate(buildPrepareInputExpression(config));
            if (!prepared?.ok) {
                return prepared;
            }
            const content = String(payload?.content || "");
            if (prepared.isContentEditable && typeof session.send === "function") {
                await session.send("Input.insertText", { text: content });
                const triggerResult = await session.evaluate(buildTriggerSubmitExpression(config));
                const composerText = String(triggerResult?.composerText || "").trim();
                if (triggerResult?.ok && composerText && !triggerResult?.sendButtonDisabled) {
                    return triggerResult;
                }
            }
            return session.evaluate(buildSubmitExpression(config, payload));
        },
        async captureResponseSnapshot(session, config) {
            return session.evaluate(buildCaptureExpression(config));
        },
    };
}
export function extractAutomationResponse(snapshot = [], baseline = [], options = {}) {
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
    return {
        text: pickBestText(currentTexts, requiredPrefix),
        source: "last_node",
        snapshotCount: currentTexts.length,
    };
}
function createDebugLogger(config, logger = console) {
    return (message, details = {}) => {
        if (!config.debug) {
            return;
        }
        logger?.warn?.(`[trae-automation-debug] ${message} ${JSON.stringify(details)}`);
    };
}
async function collectAutomationResponse({ domAdapter, session, config, baselineSnapshot, now = Date.now, debugLog = () => { }, onProgress = () => { }, }) {
    const startedAt = now();
    let lastMeaningfulText = "";
    let lastChangeAt = startedAt;
    let finalSnapshot = baselineSnapshot;
    const requiredPrefix = String(config.responseRequiredPrefix || "").trim();
    let responseDetected = false;
    const normalizePrefixComparableText = (value) => String(value || "")
        .trimStart()
        .replace(/^#+\s*/, "");
    debugLog("response collection started", {
        baselineCount: Array.isArray(baselineSnapshot) ? baselineSnapshot.length : 0,
        requiredPrefix,
        responseTimeoutMs: config.responseTimeoutMs,
        responseIdleMs: config.responseIdleMs,
    });
    while (now() - startedAt < config.responseTimeoutMs) {
        const snapshot = await domAdapter.captureResponseSnapshot(session, config);
        finalSnapshot = snapshot;
        const extracted = extractAutomationResponse(snapshot, baselineSnapshot, {
            requiredPrefix,
        });
        if (extracted.text && extracted.text !== lastMeaningfulText) {
            lastMeaningfulText = extracted.text;
            lastChangeAt = now();
            if (!responseDetected) {
                responseDetected = true;
                onProgress({ responseDetected: true });
            }
            debugLog("response changed", {
                source: extracted.source,
                snapshotCount: extracted.snapshotCount,
                preview: lastMeaningfulText.slice(0, 200),
            });
        }
        const normalizedRequiredPrefix = normalizePrefixComparableText(requiredPrefix);
        const matchesRequiredPrefix = !requiredPrefix
            || normalizePrefixComparableText(lastMeaningfulText).startsWith(normalizedRequiredPrefix);
        if (lastMeaningfulText && matchesRequiredPrefix && now() - lastChangeAt >= config.responseIdleMs) {
            debugLog("response accepted", {
                source: extracted.source,
                snapshotCount: extracted.snapshotCount,
                preview: lastMeaningfulText.slice(0, 200),
            });
            return {
                response: { text: lastMeaningfulText, source: extracted.source },
                snapshot: finalSnapshot,
            };
        }
        await sleep(config.responsePollIntervalMs);
    }
    debugLog("response timeout", {
        finalSnapshotCount: Array.isArray(finalSnapshot) ? finalSnapshot.length : 0,
        finalPreview: Array.isArray(finalSnapshot)
            ? finalSnapshot.map((entry) => String(entry?.text || "").slice(0, 160))
            : [],
        lastMeaningfulPreview: lastMeaningfulText.slice(0, 200),
        requiredPrefix,
    });
    throw new TraeAutomationError("AUTOMATION_RESPONSE_TIMEOUT", "Timed out waiting for Trae to finish responding", {
        timeoutMs: config.responseTimeoutMs,
    });
}
export function createTraeAutomationDriver(options = {}) {
    const config = buildDriverConfig(options);
    const logger = options.logger || console;
    const discoverTarget = options.discoverTarget || discoverTraeTarget;
    const connectToTarget = options.connectToTarget
        || (async (target) => createCDPSession({
            webSocketDebuggerUrl: target.webSocketDebuggerUrl,
            commandTimeoutMs: config.commandTimeoutMs,
            WebSocket: options.WebSocket,
        }));
    const domAdapter = options.domAdapter || createBrowserDomAdapter();
    const now = typeof options.now === "function" ? options.now : Date.now;
    const debugLog = createDebugLogger(config, logger);
    function resolveDiscoveryOptions(override = {}) {
        return {
            ...config.discovery,
            ...(override || {}),
        };
    }
    return {
        async getReadiness(payload = {}) {
            let session = null;
            try {
                const discovery = await discoverTarget(resolveDiscoveryOptions(payload.discovery || {}));
                session = await connectToTarget(discovery.target, config);
                const readiness = await domAdapter.inspectReadiness(session, config);
                return {
                    ready: Boolean(readiness?.ready),
                    mode: "cdp",
                    target: {
                        id: discovery.target.id,
                        title: discovery.target.title,
                        url: discovery.target.url,
                    },
                    selectors: {
                        composerSelectors: config.composerSelectors,
                        sendButtonSelectors: config.sendButtonSelectors,
                        responseSelectors: config.responseSelectors,
                        newChatSelectors: config.newChatSelectors,
                    },
                    details: readiness || null,
                };
            }
            catch (error) {
                return {
                    ready: false,
                    mode: "cdp",
                    selectors: {
                        composerSelectors: config.composerSelectors,
                        sendButtonSelectors: config.sendButtonSelectors,
                        responseSelectors: config.responseSelectors,
                        newChatSelectors: config.newChatSelectors,
                    },
                    error: normalizeAutomationError(error, "AUTOMATION_NOT_READY", "Trae automation is not ready"),
                };
            }
            finally {
                if (session) {
                    await session.close().catch(() => { });
                }
            }
        },
        async prepareSession(payload = {}) {
            let session = null;
            try {
                const discovery = await discoverTarget(resolveDiscoveryOptions(payload.discovery || {}));
                session = await connectToTarget(discovery.target, config);
                const readiness = await domAdapter.inspectReadiness(session, config);
                if (!readiness?.ready) {
                    throw new TraeAutomationError("AUTOMATION_SELECTOR_NOT_READY", "The Trae window is missing the configured selectors", {
                        readiness,
                    });
                }
                const preparation = await domAdapter.prepareSession(session, config);
                if (!preparation?.ok) {
                    throw new TraeAutomationError("AUTOMATION_PREPARE_FAILED", "Failed to prepare a fresh Trae conversation", {
                        preparation,
                    });
                }
                if (config.postActionDelayMs > 0) {
                    await sleep(config.postActionDelayMs);
                }
                return {
                    status: "ok",
                    preparation,
                    target: {
                        id: discovery.target.id,
                        title: discovery.target.title,
                        url: discovery.target.url,
                    },
                };
            }
            catch (error) {
                throw normalizeAutomationError(error, "AUTOMATION_PREPARE_FAILED", "Trae automation prepare session failed");
            }
            finally {
                if (session) {
                    await session.close().catch(() => { });
                }
            }
        },
        async sendPrompt(payload = {}) {
            let session = null;
            try {
                const discovery = await discoverTarget(resolveDiscoveryOptions(payload.discovery || {}));
                session = await connectToTarget(discovery.target, config);
                const readiness = await domAdapter.inspectReadiness(session, config);
                if (!readiness?.ready) {
                    throw new TraeAutomationError("AUTOMATION_SELECTOR_NOT_READY", "The Trae window is missing the configured selectors", {
                        readiness,
                    });
                }
                if (payload.prepare !== false) {
                    const preparation = await domAdapter.prepareSession(session, config);
                    if (!preparation?.ok) {
                        throw new TraeAutomationError("AUTOMATION_PREPARE_FAILED", "Failed to prepare a fresh Trae conversation", {
                            preparation,
                        });
                    }
                    if (config.postActionDelayMs > 0) {
                        await sleep(config.postActionDelayMs);
                    }
                }
                const baselineSnapshot = await domAdapter.captureResponseSnapshot(session, config);
                debugLog("prompt submitted", {
                    targetTitle: discovery.target.title,
                    baselineCount: Array.isArray(baselineSnapshot) ? baselineSnapshot.length : 0,
                    requiredPrefix: payload.responseRequiredPrefix ?? config.responseRequiredPrefix ?? null,
                });
                const submitResult = await domAdapter.submitPrompt(session, config, { content: payload.content });
                if (!submitResult?.ok) {
                    throw new TraeAutomationError("AUTOMATION_SUBMIT_FAILED", "Failed to submit text through the Trae window", {
                        submitResult,
                    });
                }
                if (config.postActionDelayMs > 0) {
                    await sleep(config.postActionDelayMs);
                }
                const collected = await collectAutomationResponse({
                    domAdapter,
                    session,
                    config: {
                        ...config,
                        responseRequiredPrefix: payload.responseRequiredPrefix ?? config.responseRequiredPrefix,
                        responseTimeoutMs: Number(payload.responseTimeoutMs || config.responseTimeoutMs),
                    },
                    baselineSnapshot,
                    now,
                    debugLog,
                    onProgress: payload.onProgress || (() => { }),
                });
                return {
                    status: "ok",
                    response: collected.response,
                    submitResult,
                    target: {
                        id: discovery.target.id,
                        title: discovery.target.title,
                        url: discovery.target.url,
                    },
                };
            }
            catch (error) {
                throw normalizeAutomationError(error, "AUTOMATION_REQUEST_FAILED", "Trae automation request failed");
            }
            finally {
                if (session) {
                    await session.close().catch(() => { });
                }
            }
        },
    };
}
