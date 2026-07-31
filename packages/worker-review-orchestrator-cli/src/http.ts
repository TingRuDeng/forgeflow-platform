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

type CurlRequestInit = {
  method?: string;
  body?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
};

type CurlImpl = (url: string, init: CurlRequestInit) => Promise<Record<string, unknown>>;

async function defaultCurlRequest(url: string, init: CurlRequestInit): Promise<Record<string, unknown>> {
  const method = init.method || "GET";
  const args = ["-sS", "-X", method];

  if (init.timeoutMs) {
    args.push("--max-time", String(Math.ceil(init.timeoutMs / 1000)));
  }

  if (init.body) {
    args.push("-d", init.body);
  }

  for (const [name, value] of Object.entries(init.headers ?? {})) {
    args.push("-H", `${name}: ${value}`);
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
      let json: Record<string, unknown> = {};
      try {
        json = body ? JSON.parse(body) as Record<string, unknown> : {};
      } catch {
        // Preserve a stable HTTP error when an upstream proxy returns HTML or text.
      }
      throw new Error(
        (typeof json.message === "string" && json.message)
        || (typeof json.error === "string" && json.error)
        || `HTTP ${statusCode}`,
      );
    }

    try {
      return body ? JSON.parse(body) as Record<string, unknown> : {};
    } catch {
      throw new Error("invalid JSON response");
    }
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
    const timeoutMs = Number(init.timeoutMs || defaultTimeoutMs);
    const url = `${base}${pathname}`;
    const method = (init.method || "GET").toUpperCase();

    const authToken = typeof process !== "undefined" ? process.env.DISPATCHER_API_TOKEN : undefined;
    const configToken = typeof process !== "undefined" && !authToken ? (await import("./config.js")).getDispatcherToken() : undefined;
    const headers: Record<string, string> = {};
    if (init.body) headers["content-type"] = "application/json";
    if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
    else if (configToken) headers["Authorization"] = `Bearer ${configToken}`;
    const controller = new AbortController();
    let timeoutId!: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        const error = new Error(`request timeout: ${pathname}`);
        error.name = "AbortError";
        reject(error);
      }, timeoutMs);
    });
    let response: Response;
    try {
      response = await Promise.race([
        fetchImpl(url, {
          method,
          headers,
          body: init.body ? JSON.stringify(init.body) : undefined,
          signal: controller.signal,
        }),
        timeoutPromise,
      ]);
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`request timeout: ${pathname}`);
      }

      const canRetryWithCurl = useLocalFallback && ["GET", "HEAD", "OPTIONS"].includes(method);
      if (canRetryWithCurl) {
        try {
          return await curlImpl(url, {
            method,
            body: init.body ? JSON.stringify(init.body) : undefined,
            timeoutMs,
            headers,
          });
        } catch (curlError) {
          throw curlError instanceof Error ? curlError : new Error(String(curlError));
        }
      }

      throw error instanceof Error ? error : new Error(String(error));
    }

    let text: string;
    try {
      text = await Promise.race([response.text(), timeoutPromise]);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`request timeout: ${pathname}`);
      }
      throw error instanceof Error ? error : new Error(String(error));
    } finally {
      clearTimeout(timeoutId);
    }
    let json: Record<string, unknown> = {};
    if (text) {
      try {
        json = JSON.parse(text) as Record<string, unknown>;
      } catch {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        throw new Error(`invalid JSON response: ${pathname}`);
      }
    }
    if (!response.ok) {
      throw new Error(
        (typeof json.message === "string" && json.message)
        || (typeof json.error === "string" && json.error)
        || `HTTP ${response.status}`,
      );
    }
    return json;
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
    artifactBundles: [],
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
