import type { AutomationGatewayDriver } from "./gateway-types.js";

export interface ResolveAutomationGatewayDriverOptions {
  automationDriver?: AutomationGatewayDriver;
  automationOptions?: Record<string, unknown>;
  createDriver: (options: Record<string, unknown>) => AutomationGatewayDriver;
  debugEnabled?: boolean;
}

function normalizeDriverDebug(
  automationOptions: Record<string, unknown>,
  debugEnabled: boolean,
): boolean | undefined {
  if (debugEnabled) {
    return true;
  }

  if (automationOptions.debug === undefined) {
    return undefined;
  }

  return automationOptions.debug === true
    || String(automationOptions.debug || "").trim() === "1";
}

export function resolveAutomationGatewayDriver(
  options: ResolveAutomationGatewayDriverOptions,
): AutomationGatewayDriver {
  if (options.automationDriver) {
    return options.automationDriver;
  }

  const automationOptions = options.automationOptions || {};
  const driverDebug = normalizeDriverDebug(automationOptions, options.debugEnabled === true);
  return options.createDriver({
    ...automationOptions,
    ...(driverDebug === undefined ? {} : { debug: driverDebug }),
  });
}
