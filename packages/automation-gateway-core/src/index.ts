export {
  createAutomationGatewayDebugLogger,
  isAutomationGatewayDebugEnabled,
} from "./debug-log.js";

export {
  ApiError,
  normalizeApiError,
} from "./gateway-errors.js";

export {
  handleAutomationGatewayRequest,
  isTimeoutError,
  parseDiscoveryFromQuery,
} from "./gateway-handler.js";

export {
  startAutomationGatewayHttpServer,
} from "./gateway-http-server.js";

export {
  AUTOMATION_SESSION_RESTART_ERROR,
  AUTOMATION_SESSION_TTL_MS,
  AutomationSessionStatus,
  createPersistentAutomationSessionStore,
  getAutomationSessionPublicShape,
} from "./session-store.js";

export type {
  AutomationGatewayDebugLogger,
  AutomationGatewayDebugLoggerOptions,
} from "./debug-log.js";

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

export type {
  StartedAutomationGatewayHttpServer,
  StartAutomationGatewayHttpServerOptions,
} from "./gateway-http-server.js";

export type {
  AutomationSessionPublic,
  AutomationSessionRecord,
  AutomationSessionStatusValue,
  AutomationSessionStore,
  AutomationSessionStoreOptions,
  CreateAutomationSessionParams,
} from "./session-store.js";

export {
  getLastReportFieldValue,
  isEquivalentReportedTaskId,
  isPlaceholderTaskId,
  looksLikeTemplatePlaceholderReport,
} from "./report.js";
