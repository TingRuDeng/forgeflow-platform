export {
  ApiError,
  normalizeApiError,
} from "./gateway-errors.js";

export {
  handleAutomationGatewayRequest,
  isTimeoutError,
  parseDiscoveryFromQuery,
} from "./gateway-handler.js";

export type {
  AutomationGatewayDriver,
  AutomationGatewayRequest,
  AutomationGatewayResponse,
  AutomationGatewaySession,
  AutomationGatewaySessionStore,
  DiscoveryHints,
  HandleAutomationGatewayRequestOptions,
  NormalizedAutomationError,
} from "./gateway-types.js";

export {
  getLastReportFieldValue,
  isEquivalentReportedTaskId,
  isPlaceholderTaskId,
  looksLikeTemplatePlaceholderReport,
} from "./report.js";
