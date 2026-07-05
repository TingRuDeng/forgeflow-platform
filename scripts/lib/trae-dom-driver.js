export { DEFAULT_ACTIVITY_SELECTORS, DEFAULT_COMPOSER_SELECTORS, DEFAULT_NEW_CHAT_SELECTORS, DEFAULT_POST_ACTION_DELAY_MS, DEFAULT_RESPONSE_IDLE_MS, DEFAULT_RESPONSE_POLL_INTERVAL_MS, DEFAULT_RESPONSE_SELECTORS, DEFAULT_RESPONSE_TIMEOUT_MS, DEFAULT_SEND_BUTTON_SELECTORS, buildCaptureExpression, buildPrepareInputExpression, buildPrepareSessionExpression, buildReadinessExpression, buildSubmitExpression, buildTriggerSubmitExpression, createBrowserDomAdapter, extractAutomationResponse, } from "@tingrudeng/automation-gateway-core";
import { buildDriverConfig as buildCoreDriverConfig, createTraeAutomationDriver as createCoreTraeAutomationDriver, } from "@tingrudeng/automation-gateway-core";
export function buildDriverConfig(options = {}) {
    return buildCoreDriverConfig({
        activitySelectors: [],
        allowPlainTextResponse: true,
        ...options,
    });
}
export function createTraeAutomationDriver(options = {}) {
    return createCoreTraeAutomationDriver({
        activitySelectors: [],
        allowPlainTextResponse: true,
        ...options,
    });
}
