// @ts-nocheck
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
export const DEFAULT_ACTIVITY_SELECTORS = [".chat-content-container", ".chat-list-wrapper"];
export const DEFAULT_NEW_CHAT_SELECTORS = ["a.codicon-icube-NewChat", "button[aria-label*='New Chat']"];
export const DEFAULT_RESPONSE_POLL_INTERVAL_MS = Number(process.env.TRAE_RESPONSE_POLL_INTERVAL_MS || 350);
export const DEFAULT_RESPONSE_IDLE_MS = Number(process.env.TRAE_RESPONSE_IDLE_MS || 1200);
export const DEFAULT_RESPONSE_TIMEOUT_MS = Number(process.env.TRAE_RESPONSE_TIMEOUT_MS || 30000);
export const DEFAULT_POST_ACTION_DELAY_MS = Number(process.env.TRAE_POST_ACTION_DELAY_MS || 350);

export interface DriverConfig {
  discovery: {
    host?: string;
    port?: number | string;
    timeoutMs?: number | string;
    titleContains?: string | string[];
    urlContains?: string | string[];
    targetType?: string;
    fetchImpl?: typeof fetch;
  };
  composerSelectors: string[];
  sendButtonSelectors: string[];
  responseSelectors: string[];
  activitySelectors: string[];
  newChatSelectors: string[];
  responsePollIntervalMs: number;
  responseIdleMs: number;
  responseTimeoutMs: number;
  postActionDelayMs: number;
  commandTimeoutMs: number;
  responseRequiredPrefix?: string;
  allowPlainTextResponse?: boolean;
  debug: boolean;
}

export interface DriverOptions {
  host?: string;
  port?: number | string;
  discoveryTimeoutMs?: number | string;
  titleContains?: string | string[];
  urlContains?: string | string[];
  targetType?: string;
  fetchImpl?: typeof fetch;
  composerSelectors?: string | string[];
  sendButtonSelectors?: string | string[];
  responseSelectors?: string | string[];
  activitySelectors?: string | string[];
  newChatSelectors?: string | string[];
  responsePollIntervalMs?: number | string;
  responseIdleMs?: number | string;
  responseTimeoutMs?: number | string;
  postActionDelayMs?: number | string;
  commandTimeoutMs?: number | string;
  responseRequiredPrefix?: string;
  allowPlainTextResponse?: boolean;
  debug?: boolean | string;
}

export interface TraeAutomationDriverOptions extends DriverOptions {
  logger?: Console;
  discoverTarget?: (options: Record<string, unknown>) => Promise<unknown>;
  connectToTarget?: (target: { webSocketDebuggerUrl?: string }, config: DriverConfig) => Promise<unknown>;
  domAdapter?: unknown;
  now?: () => number;
  WebSocket?: typeof globalThis.WebSocket;
}

export interface TraeAutomationDriver {
  getReadiness: (payload?: { discovery?: Record<string, unknown> }) => Promise<unknown>;
  prepareSession: (payload?: { discovery?: Record<string, unknown>; chatMode?: string }) => Promise<unknown>;
  sendPrompt: (payload?: {
    content?: string;
    discovery?: Record<string, unknown>;
    sessionId?: string | null;
    expectedTaskId?: string | null;
    chatMode?: string | null;
    prepare?: boolean;
    responseRequiredPrefix?: string;
    responseTimeoutMs?: number | string;
    onProgress?: (details: { responseDetected: boolean }) => void;
  }) => Promise<unknown>;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseSelectorList(value, fallbackSelectors, options = {}) {
  if (Array.isArray(value)) {
    const parsed = value.map((item) => String(item).trim()).filter(Boolean);
    if (parsed.length > 0 || options.allowExplicitEmptyArray) {
      return parsed;
    }
    return [...fallbackSelectors];
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
    composerSelectors: parseSelectorList(
      options.composerSelectors || process.env.TRAE_COMPOSER_SELECTORS,
      DEFAULT_COMPOSER_SELECTORS
    ),
    sendButtonSelectors: parseSelectorList(
      options.sendButtonSelectors || process.env.TRAE_SEND_BUTTON_SELECTORS,
      DEFAULT_SEND_BUTTON_SELECTORS
    ),
    responseSelectors: parseSelectorList(
      options.responseSelectors || process.env.TRAE_RESPONSE_SELECTORS,
      DEFAULT_RESPONSE_SELECTORS
    ),
    activitySelectors: parseSelectorList(
      options.activitySelectors || process.env.TRAE_ACTIVITY_SELECTORS,
      DEFAULT_ACTIVITY_SELECTORS,
      { allowExplicitEmptyArray: Array.isArray(options.activitySelectors) }
    ),
    newChatSelectors: parseSelectorList(
      options.newChatSelectors || process.env.TRAE_NEW_CHAT_SELECTORS,
      DEFAULT_NEW_CHAT_SELECTORS
    ),
    responsePollIntervalMs: Number(
      firstDefined(
        options.responsePollIntervalMs,
        process.env.TRAE_RESPONSE_POLL_INTERVAL_MS,
        DEFAULT_RESPONSE_POLL_INTERVAL_MS
      )
    ),
    responseIdleMs: Number(
      firstDefined(options.responseIdleMs, process.env.TRAE_RESPONSE_IDLE_MS, DEFAULT_RESPONSE_IDLE_MS)
    ),
    responseTimeoutMs: Number(
      firstDefined(
        options.responseTimeoutMs,
        process.env.TRAE_RESPONSE_TIMEOUT_MS,
        DEFAULT_RESPONSE_TIMEOUT_MS
      )
    ),
    postActionDelayMs: Number(
      firstDefined(options.postActionDelayMs, process.env.TRAE_POST_ACTION_DELAY_MS, DEFAULT_POST_ACTION_DELAY_MS)
    ),
    commandTimeoutMs: Number(
      firstDefined(options.commandTimeoutMs, process.env.TRAE_CDP_COMMAND_TIMEOUT_MS, 5000)
    ),
    responseRequiredPrefix: firstDefined(
      options.responseRequiredPrefix,
      process.env.TRAE_RESPONSE_REQUIRED_PREFIX
    ),
    allowPlainTextResponse: options.allowPlainTextResponse === true,
    debug: firstDefined(options.debug, process.env.TRAE_AUTOMATION_DEBUG) === true
      || String(firstDefined(options.debug, process.env.TRAE_AUTOMATION_DEBUG) || "").trim() === "1",
  };
}
