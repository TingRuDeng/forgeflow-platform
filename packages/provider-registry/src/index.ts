export type ProviderId = "claude" | "codex" | "gemini" | "opencode" | "qwen" | "trae";
export type EnforcementMode = "strict" | "best_effort";
export type TaskMode = "run" | "review";
export type ProviderKind = "core" | "third_party";
export type ProviderAdmissionReasonCode =
  | "unsupported_mode"
  | "unsupported_permission"
  | "third_party_not_allowlisted"
  | "missing_worker_protocol_v1";

export interface ProviderDefinition {
  id: ProviderId;
  supportedPermissionKeys: string[];
  defaultPermissions: Record<string, string>;
  supportedModes: TaskMode[];
}

export interface ProviderAdmissionRequest {
  providerId: string;
  mode: string;
  permissions?: Record<string, string>;
  declaredCapabilities?: string[];
  thirdPartyAllowlist?: string[];
}

export interface ProviderAdmissionDecision {
  ok: boolean;
  providerId: string;
  providerKind?: ProviderKind;
  reasonCode?: ProviderAdmissionReasonCode;
  normalizedPermissions?: Record<string, string>;
}

const PROVIDERS: Record<ProviderId, ProviderDefinition> = {
  claude: {
    id: "claude",
    supportedPermissionKeys: ["permission_mode"],
    defaultPermissions: {
      permission_mode: "plan",
    },
    supportedModes: ["run", "review"],
  },
  codex: {
    id: "codex",
    supportedPermissionKeys: ["sandbox"],
    defaultPermissions: {
      sandbox: "workspace-write",
    },
    supportedModes: ["run", "review"],
  },
  gemini: {
    id: "gemini",
    supportedPermissionKeys: [],
    defaultPermissions: {},
    supportedModes: ["run", "review"],
  },
  opencode: {
    id: "opencode",
    supportedPermissionKeys: [],
    defaultPermissions: {},
    supportedModes: ["run", "review"],
  },
  qwen: {
    id: "qwen",
    supportedPermissionKeys: [],
    defaultPermissions: {},
    supportedModes: ["run", "review"],
  },
  trae: {
    id: "trae",
    supportedPermissionKeys: ["automation_url", "remote_debugging_port", "git_ssh_command"],
    defaultPermissions: {},
    supportedModes: ["run", "review"],
  },
};

export function getProviderDefinition(provider: ProviderId): ProviderDefinition {
  return PROVIDERS[provider];
}

function isProviderId(value: string): value is ProviderId {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, value);
}

function isTaskMode(value: string): value is TaskMode {
  return value === "run" || value === "review";
}

export function normalizePermissions(
  provider: ProviderId,
  permissions: Record<string, string>,
  mode: EnforcementMode,
): Record<string, string> {
  const definition = getProviderDefinition(provider);
  const allowed = new Set(definition.supportedPermissionKeys);
  const entries = Object.entries(permissions);
  const unsupported = entries.filter(([key]) => !allowed.has(key));

  if (unsupported.length > 0 && mode === "strict") {
    throw new Error("permission_enforcement_failed");
  }

  return Object.fromEntries(entries.filter(([key]) => allowed.has(key)));
}

export function evaluateProviderAdmission(request: ProviderAdmissionRequest): ProviderAdmissionDecision {
  const permissions = request.permissions ?? {};
  if (isProviderId(request.providerId)) {
    const definition = getProviderDefinition(request.providerId);
    if (!isTaskMode(request.mode) || !definition.supportedModes.includes(request.mode)) {
      return {
        ok: false,
        providerId: request.providerId,
        providerKind: "core",
        reasonCode: "unsupported_mode",
      };
    }

    try {
      return {
        ok: true,
        providerId: request.providerId,
        providerKind: "core",
        normalizedPermissions: normalizePermissions(request.providerId, permissions, "strict"),
      };
    } catch {
      return {
        ok: false,
        providerId: request.providerId,
        providerKind: "core",
        reasonCode: "unsupported_permission",
      };
    }
  }

  if (!(request.thirdPartyAllowlist ?? []).includes(request.providerId)) {
    return {
      ok: false,
      providerId: request.providerId,
      providerKind: "third_party",
      reasonCode: "third_party_not_allowlisted",
    };
  }

  if (!isTaskMode(request.mode)) {
    return {
      ok: false,
      providerId: request.providerId,
      providerKind: "third_party",
      reasonCode: "unsupported_mode",
    };
  }

  if (!(request.declaredCapabilities ?? []).includes("worker-protocol-v1")) {
    return {
      ok: false,
      providerId: request.providerId,
      providerKind: "third_party",
      reasonCode: "missing_worker_protocol_v1",
    };
  }

  if (Object.keys(permissions).length > 0) {
    return {
      ok: false,
      providerId: request.providerId,
      providerKind: "third_party",
      reasonCode: "unsupported_permission",
    };
  }

  return {
    ok: true,
    providerId: request.providerId,
    providerKind: "third_party",
    normalizedPermissions: {},
  };
}
