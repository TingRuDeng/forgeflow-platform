import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

interface LocalDispatcherResponse {
  status: number;
  headers?: Record<string, string>;
  json?: unknown;
  text?: string;
}

type LocalDispatcherHandler = (input: {
  stateDir: string;
  method: string;
  pathname: string;
  body?: unknown;
  clientAddress?: string;
  internalCall?: boolean;
}) => Promise<LocalDispatcherResponse> | LocalDispatcherResponse;

let cachedHandler: LocalDispatcherHandler | null = null;

function candidateRepoRoots() {
  const currentFile = fileURLToPath(import.meta.url);
  return [
    path.resolve(path.dirname(currentFile), "../../../"),
    process.cwd(),
  ];
}

async function resolveHandler() {
  if (cachedHandler) {
    return cachedHandler;
  }

  for (const root of candidateRepoRoots()) {
    const candidates = [
      path.join(root, "apps/dispatcher/dist/modules/server/dispatcher-server.js"),
      path.join(root, "scripts/lib/dispatcher-server.js"),
    ];

    for (const candidate of candidates) {
      if (!fs.existsSync(candidate)) {
        continue;
      }
      const mod = await import(pathToFileURL(candidate).href) as {
        handleDispatcherHttpRequest?: LocalDispatcherHandler;
      };
      if (typeof mod.handleDispatcherHttpRequest === "function") {
        cachedHandler = mod.handleDispatcherHttpRequest;
        return cachedHandler;
      }
    }
  }

  throw new Error(
    "state-dir mode requires a local forgeflow-platform checkout with apps/dispatcher/dist/modules/server/dispatcher-server.js or scripts/lib/dispatcher-server.js available",
  );
}

export async function runLocalDispatcherRequest(input: {
  stateDir: string;
  method: string;
  pathname: string;
  body?: unknown;
}) {
  const handler = await resolveHandler();
  return await handler({
    stateDir: path.resolve(input.stateDir),
    method: input.method,
    pathname: input.pathname,
    body: input.body,
    clientAddress: "127.0.0.1",
    internalCall: true,
  });
}

export async function loadLocalSnapshot(stateDir: string) {
  const resolvedStateDir = path.resolve(stateDir);
  const jsonSnapshotPath = path.join(resolvedStateDir, "runtime-state.json");
  const sqliteSnapshotPath = path.join(resolvedStateDir, "runtime-state.db");

  if (fs.existsSync(jsonSnapshotPath) && !fs.existsSync(sqliteSnapshotPath)) {
    return JSON.parse(fs.readFileSync(jsonSnapshotPath, "utf8")) as Record<string, unknown>;
  }

  const response = await runLocalDispatcherRequest({
    stateDir: resolvedStateDir,
    method: "GET",
    pathname: "/api/dashboard/snapshot",
  });
  return (response.json ?? {}) as Record<string, unknown>;
}
