import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import type {
  JsonHttpClientOptions,
  JsonHttpRequestOptions,
  LocalRuntimeState,
} from "./types.js";
import { formatLocalTimestamp } from "./time.js";

function isLocalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "0.0.0.0";
  } catch {
    return false;
  }
}

type CurlImpl = (url: string, init: { method?: string; body?: string; timeoutMs?: number }) => Promise<unknown>;

async function defaultCurlRequest(url: string, init: { method?: string; body?: string; timeoutMs?: number }): Promise<unknown> {
  const method = init.method || "GET";
  const args = ["-sS", "-X", method];

  if (init.timeoutMs) {
    args.push("--max-time", String(Math.ceil(init.timeoutMs / 1000)));
  }

  if (init.body) {
    args.push("-d", init.body);
    args.push("-H", "Content-Type: application/json");
  }

  args.push("-w", "\n%{http_code}");
  args.push("-o", "-");
  args.push(url);

  try {
    const output = execFileSync("curl", args, { encoding: "utf8" });
    const lastNewline = output.lastIndexOf("\n");
    const body = lastNewline >= 0 ? output.slice(0, lastNewline) : output;
    const statusCode = lastNewline >= 0 ? parseInt(output.slice(lastNewline + 1), 10) : 0;

    if (statusCode < 200 || statusCode >= 300) {
      const json = body ? JSON.parse(body) : {};
      throw new Error(json.message || json.error || `HTTP ${statusCode}`);
    }

    return body ? JSON.parse(body) : {};
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`curl fallback failed: ${error.message}`);
    }
    throw error;
  }
}

export function createJsonHttpClient(baseUrl: string, options: JsonHttpClientOptions & { curlImpl?: CurlImpl } = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("global fetch is required");
  }
  const base = String(baseUrl || "").replace(/\/$/, "");
  const defaultTimeoutMs = Number(options.requestTimeoutMs || 10_000);
  const useLocalFallback = isLocalUrl(base);
  const curlImpl: CurlImpl = options.curlImpl || defaultCurlRequest;

  async function request(pathname: string, init: JsonHttpRequestOptions = {}) {
    const controller = new AbortController();
    const timeoutMs = Number(init.timeoutMs || defaultTimeoutMs);
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const url = `${base}${pathname}`;

    try {
      const response = await fetchImpl(url, {
        method: init.method || "GET",
        headers: init.body ? { "content-type": "application/json" } : undefined,
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const text = await response.text();
      const json = text ? JSON.parse(text) : {};
      if (!response.ok) {
        throw new Error(json.message || json.error || `HTTP ${response.status}`);
      }
      return json;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`request timeout: ${pathname}`);
      }

      if (useLocalFallback) {
        try {
          return await curlImpl(url, {
            method: init.method,
            body: init.body ? JSON.stringify(init.body) : undefined,
            timeoutMs,
          });
        } catch (curlError) {
          throw curlError instanceof Error ? curlError : new Error(String(curlError));
        }
      }

      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  return { request };
}

export function createEmptyRuntimeState(): LocalRuntimeState {
  return {
    version: 1,
    updatedAt: formatLocalTimestamp(),
    sequence: 0,
    workers: [],
    tasks: [],
    events: [],
    assignments: [],
    reviews: [],
    pullRequests: [],
    dispatches: [],
  };
}

function runtimeStatePath(stateDir: string) {
  return path.join(stateDir, "runtime-state.json");
}

export function loadRuntimeState(stateDir: string): LocalRuntimeState {
  const filePath = runtimeStatePath(stateDir);
  if (!fs.existsSync(filePath)) {
    return createEmptyRuntimeState();
  }

  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<LocalRuntimeState>;
  return {
    ...createEmptyRuntimeState(),
    ...parsed,
  };
}

export function saveRuntimeState(stateDir: string, state: LocalRuntimeState) {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    runtimeStatePath(stateDir),
    `${JSON.stringify({
      ...state,
      updatedAt: formatLocalTimestamp(),
    }, null, 2)}\n`,
  );
}

export async function readJsonInput(
  source: string,
  options: {
    readStdin?: () => Promise<string>;
  } = {},
) {
  if (!source || source === "-") {
    const readStdin = options.readStdin || (async () => {
      let text = "";
      for await (const chunk of process.stdin) {
        text += chunk;
      }
      return text;
    });
    const raw = await readStdin();
    return JSON.parse(raw);
  }

  const filePath = path.resolve(source);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
