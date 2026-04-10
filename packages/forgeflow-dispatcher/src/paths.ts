import os from "node:os";
import path from "node:path";

export const CONFIG_DIR = path.join(os.homedir(), ".forgeflow-dispatcher");
export const DEFAULT_CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
export const DEFAULT_STATE_DIR = path.join(CONFIG_DIR, "state");
