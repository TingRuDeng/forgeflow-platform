import os from "node:os";
import path from "node:path";
import { AutomationSessionStatus as SessionStatus, createPersistentAutomationSessionStore, } from "@tingrudeng/automation-gateway-core";
import { formatLocalTimestamp } from "./time.js";
// 默认使用发布包同一用户级目录，避免脚本从不同工作目录启动时写入不同状态文件。
export const DEFAULT_STATE_DIR = path.join(os.homedir(), ".forgeflow-trae-beta", "sessions");
export { SessionStatus };
export function createSessionStore(stateDir, options = {}) {
    return createPersistentAutomationSessionStore(stateDir || DEFAULT_STATE_DIR, {
        ...options,
        now: options.now || (() => formatLocalTimestamp()),
        includeResponseText: false,
    });
}
