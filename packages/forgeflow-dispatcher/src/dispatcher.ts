import type { DispatcherAuthMode, DispatcherRuntimeConfig } from "./config.ts";

import { startDispatcherServer } from "../../../apps/dispatcher/src/modules/server/dispatcher-server.ts";

function applyAuthEnvironment(authMode: DispatcherAuthMode, apiToken?: string) {
  process.env.DISPATCHER_AUTH_MODE = authMode;
  if (apiToken) {
    process.env.DISPATCHER_API_TOKEN = apiToken;
  } else {
    delete process.env.DISPATCHER_API_TOKEN;
  }
}

export async function startDispatcher(config: DispatcherRuntimeConfig) {
  applyAuthEnvironment(config.authMode, config.apiToken);
  process.env.RUNTIME_STATE_BACKEND = config.persistenceBackend;
  const instance = await startDispatcherServer({
    host: config.host,
    port: config.port,
    stateDir: config.stateDir,
  });
  console.log(JSON.stringify({
    status: "listening",
    host: instance.host,
    port: instance.port,
    baseUrl: instance.baseUrl,
    stateDir: config.stateDir,
    persistenceBackend: config.persistenceBackend,
    authMode: config.authMode,
  }, null, 2));
}
