// @ts-nocheck
import { BROWSER_HELPERS_SOURCE, serialize } from "./trae-dom-browser-helpers.js";
export function buildReadinessExpression(config) {
  return `(() => {
    ${BROWSER_HELPERS_SOURCE}
    const composerSelectors = ${serialize(config.composerSelectors || [])};
    const sendButtonSelectors = ${serialize(config.sendButtonSelectors || [])};
    const responseSelectors = ${serialize(config.responseSelectors || [])};
    const newChatSelectors = ${serialize(config.newChatSelectors || [])};
    const composer = traeAutomationPickVisible(composerSelectors);
    const sendButton = traeAutomationPickVisible(sendButtonSelectors);
    const newChatButton = traeAutomationPickVisible(newChatSelectors);
    const responses = traeAutomationSnapshotResponses(responseSelectors, { allowHiddenText: true });
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
      }) || null : null,
      newChatFound: Boolean(newChatButton),
      newChatSelector: newChatButton ? newChatSelectors.find((selector) => {
        try {
          return Array.from(document.querySelectorAll(selector)).includes(newChatButton);
        } catch {
          return false;
        }
      }) || null : null,
      responseFound: responses.length > 0,
      responseCount: responses.length,
      readyState: document.readyState || null
    };
  })()`;
}

function looksLikeEditorWorkbenchTitle(title) {
  if (typeof title !== "string") {
    return false;
  }
  const normalized = title.trim();
  if (!normalized) {
    return false;
  }
  return /\(preview\)/i.test(normalized)
    || /\.[a-z0-9]+(?:\s|\(|—|-|$)/i.test(normalized);
}

export function normalizeReadiness(readiness, target) {
  if (!readiness || typeof readiness !== "object") {
    return readiness;
  }

  const normalized = { ...readiness };
  const title = String(normalized.title || target?.title || "");
  const editorLikeTitle = looksLikeEditorWorkbenchTitle(title);
  const hasChatEvidence = Boolean(normalized.newChatFound) || Boolean(normalized.responseFound);

  if (normalized.ready && editorLikeTitle && !hasChatEvidence) {
    normalized.ready = false;
    normalized.readyReason = "editor_like_without_chat_evidence";
  }

  return normalized;
}

export function buildPrepareSessionExpression(config, chatMode = "new_chat") {
  if (chatMode === "continue") {
    return `(() => {
      ${BROWSER_HELPERS_SOURCE}
      return { ok: true, clicked: false, skipped: true, mode: "continue" };
    })()`;
  }
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

export function buildPrepareInputExpression(config, skipClear = false) {
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

    if (!${skipClear}) {
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
  return `((payload = {}) => {
    ${BROWSER_HELPERS_SOURCE}
    const selectors = Array.isArray(payload.selectors) && payload.selectors.length > 0
      ? payload.selectors
      : ${serialize(config.responseSelectors)};
    const allowHiddenText = payload.allowHiddenText === true;
    return traeAutomationSnapshotResponses(selectors, { allowHiddenText });
  })(${serialize(undefined)})`;
}

export function createBrowserDomAdapter() {
  return {
    async inspectReadiness(session, config) {
      return session.evaluate(buildReadinessExpression(config));
    },
    async prepareSession(session, config, payload = {}) {
      const chatMode = payload?.chatMode || "new_chat";
      if (!config.newChatSelectors.length) {
        return { ok: true, clicked: false, skipped: true };
      }
      return session.evaluate(buildPrepareSessionExpression(config, chatMode));
    },
    async submitPrompt(session, config, payload) {
      const chatMode = payload?.chatMode || "new_chat";
      const skipClear = chatMode === "continue";
      const prepared = await session.evaluate(buildPrepareInputExpression(config, skipClear));
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
    async captureResponseSnapshot(session, config, payload = {}) {
      const expression = `(() => {
        ${BROWSER_HELPERS_SOURCE}
        const selectors = ${serialize(Array.isArray(payload.selectors) ? payload.selectors : config.responseSelectors)};
        const allowHiddenText = ${payload.allowHiddenText === true ? "true" : "false"};
        return traeAutomationSnapshotResponses(selectors, { allowHiddenText });
      })()`;
      return session.evaluate(expression);
    },
  };
}
