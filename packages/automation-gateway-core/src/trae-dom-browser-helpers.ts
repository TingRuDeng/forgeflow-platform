// @ts-nocheck
export function serialize(value) {
  return JSON.stringify(value);
}

export const BROWSER_HELPERS_SOURCE = `
function traeAutomationQueryAll(selectors) {
  const root = arguments.length > 1 && arguments[1] ? arguments[1] : document;
  const seen = new Set();
  const elements = [];
  for (const selector of selectors) {
    if (typeof selector !== "string" || !selector.trim()) {
      continue;
    }
    let matched = [];
    try {
      matched = Array.from(root.querySelectorAll(selector));
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
  const root = Array.isArray(options.rootSelectors) && options.rootSelectors.length > 0
    ? traeAutomationPickVisible(options.rootSelectors, { pick: options.rootPick || "first" })
    : null;
  return traeAutomationFilterTopLevel(
    traeAutomationQueryAll(selectors, root || document).filter((element) => traeAutomationIsVisible(element, options))
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
