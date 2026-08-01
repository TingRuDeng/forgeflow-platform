import {
  getDispatcherAuthHeader,
  normalizeOptionalDispatcherToken,
} from "@tingrudeng/beta-runtime-core/runtime/dispatcher-auth.js";

export { getDispatcherAuthHeader };

export function isDispatcherAuthEnabled(): boolean {
  return normalizeOptionalDispatcherToken(
    process.env.DISPATCHER_API_TOKEN,
    "DISPATCHER_API_TOKEN",
  ) !== undefined;
}
