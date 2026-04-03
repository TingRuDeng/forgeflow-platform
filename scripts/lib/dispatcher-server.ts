import { fileURLToPath } from "node:url";
import path from "node:path";
import { pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const dispatcherServerDistPath = path.join(
  repoRoot,
  "apps",
  "dispatcher",
  "dist",
  "modules",
  "server",
  "dispatcher-server.js",
);

await import("./dispatcher-state.js");
const { handleDispatcherHttpRequest, readJsonBody, startDispatcherServer } = await import(
  pathToFileURL(dispatcherServerDistPath).href
);

export { handleDispatcherHttpRequest, readJsonBody, startDispatcherServer };
