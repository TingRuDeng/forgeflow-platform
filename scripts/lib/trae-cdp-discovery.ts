import { TraeAutomationError } from "./trae-automation-errors.js";

export const DEFAULT_DEBUG_HOST = "127.0.0.1";
export const DEFAULT_DEBUG_PORT = 9222;
export const DEFAULT_DISCOVERY_TIMEOUT_MS = 3000;
export const DEFAULT_TARGET_TYPE = "page";

export interface DiscoveryConfig {
  host: string;
  port: number;
  timeoutMs: number;
  targetType: string;
  titleContains: string[];
  urlContains: string[];
}

export interface DebuggerVersion {
  Browser: string;
  "Protocol-Version": string;
  "User-Agent": string;
  "V8-Version": string;
  "WebKit-Version": string;
  webSocketDebuggerUrl?: string;
  host?: string;
  port?: number;
  baseUrl?: string;
  [key: string]: unknown;
}

export interface DebuggerTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
  [key: string]: unknown;
}

function parseContainsList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function normalizeLoopbackHost(value: unknown): string {
  const host = String(value || "").trim().toLowerCase();
  if (!host || host === "localhost") {
    return DEFAULT_DEBUG_HOST;
  }
  return host;
}

export interface DiscoveryOptions {
  host?: string;
  port?: number | string;
  timeoutMs?: number | string;
  targetType?: string;
  titleContains?: string | string[];
  urlContains?: string | string[];
  fetchImpl?: typeof fetch;
}

export function buildDiscoveryConfig(options: DiscoveryOptions = {}): DiscoveryConfig {
  return {
    host: normalizeLoopbackHost(options.host || process.env.TRAE_CDP_HOST || DEFAULT_DEBUG_HOST),
    port: Number(options.port || process.env.TRAE_REMOTE_DEBUGGING_PORT || DEFAULT_DEBUG_PORT),
    timeoutMs: Number(
      options.timeoutMs || process.env.TRAE_CDP_DISCOVERY_TIMEOUT_MS || DEFAULT_DISCOVERY_TIMEOUT_MS
    ),
    targetType: String(options.targetType || process.env.TRAE_CDP_TARGET_TYPE || DEFAULT_TARGET_TYPE).trim()
      || DEFAULT_TARGET_TYPE,
    titleContains: parseContainsList(options.titleContains || process.env.TRAE_CDP_TARGET_TITLE_CONTAINS),
    urlContains: parseContainsList(options.urlContains || process.env.TRAE_CDP_TARGET_URL_CONTAINS),
  };
}

export function buildDebuggerBaseUrl(options: DiscoveryOptions = {}): string {
  const config = buildDiscoveryConfig(options);
  return `http://${config.host}:${config.port}`;
}

export async function fetchDebuggerJson(pathname: string, options: DiscoveryOptions = {}): Promise<unknown> {
  const config = buildDiscoveryConfig(options);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new TraeAutomationError("CDP_FETCH_UNAVAILABLE", "Global fetch is not available");
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetchImpl(`${buildDebuggerBaseUrl(config)}${pathname}`, {
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new TraeAutomationError("CDP_DISCOVERY_HTTP_ERROR", "Debugger endpoint returned an HTTP error", {
        pathname,
        status: response.status,
      });
    }

    return await response.json();
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      throw new TraeAutomationError("CDP_DISCOVERY_TIMEOUT", "Timed out while querying the debugger endpoint", {
        pathname,
        timeoutMs: config.timeoutMs,
      });
    }
    if (error instanceof TraeAutomationError) {
      throw error;
    }
    throw new TraeAutomationError("CDP_DISCOVERY_FAILED", "Failed to query the debugger endpoint", {
      pathname,
      message: (error as Error)?.message || String(error),
    });
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export function isInspectablePageTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") {
    return false;
  }
  const t = target as Record<string, unknown>;
  if (t.type !== "page") {
    return false;
  }
  const url = String(t.url || "");
  return !url.startsWith("devtools://");
}

function scoreTarget(target: DebuggerTarget, config: DiscoveryConfig): number {
  if (!isInspectablePageTarget(target)) {
    return Number.NEGATIVE_INFINITY;
  }
  if (config.targetType && target.type !== config.targetType) {
    return Number.NEGATIVE_INFINITY;
  }

  const title = String(target.title || "").toLowerCase();
  const url = String(target.url || "").toLowerCase();
  let score = 0;

  if (config.titleContains.length > 0) {
    const matchedTitles = config.titleContains.filter((needle) => title.includes(needle.toLowerCase()));
    if (matchedTitles.length === 0) {
      return Number.NEGATIVE_INFINITY;
    }
    score += matchedTitles.length * 20;
  } else if (title) {
    score += 5;
  }

  if (config.urlContains.length > 0) {
    const matchedUrls = config.urlContains.filter((needle) => url.includes(needle.toLowerCase()));
    if (matchedUrls.length === 0) {
      return Number.NEGATIVE_INFINITY;
    }
    score += matchedUrls.length * 10;
  } else if (url && url !== "about:blank") {
    score += 2;
  }

  if (title.includes("trae")) {
    score += 4;
  }
  if (url.includes("trae")) {
    score += 3;
  }

  return score;
}

export function selectTraeTarget(targets: DebuggerTarget[] = [], options: DiscoveryOptions = {}): DebuggerTarget {
  const config = buildDiscoveryConfig(options);
  const rankedTargets = targets
    .map((target) => ({ target, score: scoreTarget(target, config) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => right.score - left.score);

  if (rankedTargets.length === 0) {
    throw new TraeAutomationError("CDP_TARGET_NOT_FOUND", "No matching Trae page target was found", {
      inspectedTargetCount: Array.isArray(targets) ? targets.length : 0,
      titleContains: config.titleContains,
      urlContains: config.urlContains,
      targetType: config.targetType,
    });
  }

  return rankedTargets[0].target;
}

export async function getDebuggerVersion(options: DiscoveryOptions = {}): Promise<DebuggerVersion> {
  const config = buildDiscoveryConfig(options);
  const version = await fetchDebuggerJson("/json/version", options) as DebuggerVersion;
  return {
    ...version,
    host: config.host,
    port: config.port,
    baseUrl: buildDebuggerBaseUrl(config),
  };
}

export async function listDebuggerTargets(options: DiscoveryOptions = {}): Promise<DebuggerTarget[]> {
  return fetchDebuggerJson("/json/list", options) as Promise<DebuggerTarget[]>;
}

export interface DiscoverTraeTargetResult {
  config: DiscoveryConfig;
  version: DebuggerVersion;
  target: DebuggerTarget;
  targets: DebuggerTarget[];
}

export async function discoverTraeTarget(options: DiscoveryOptions = {}): Promise<DiscoverTraeTargetResult> {
  const config = buildDiscoveryConfig(options);
  const [version, targets] = await Promise.all([
    getDebuggerVersion({ ...options, ...config }),
    listDebuggerTargets({ ...options, ...config }),
  ]);
  const target = selectTraeTarget(targets, config);
  return { config, version, target, targets };
}
