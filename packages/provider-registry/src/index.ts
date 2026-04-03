export type ProviderId = "claude" | "codex" | "gemini" | "opencode" | "qwen";
export type EnforcementMode = "strict" | "best_effort";
export type TaskMode = "run" | "review";

export interface ProviderDefinition {
  id: ProviderId;
  supportedPermissionKeys: string[];
  defaultPermissions: Record<string, string>;
  supportedModes: TaskMode[];
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
};

export function getProviderDefinition(provider: ProviderId): ProviderDefinition {
  return PROVIDERS[provider];
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
