import {
  getProviderDefinition,
  normalizePermissions,
  type ProviderId,
} from "@forgeflow/provider-registry";

export interface ProviderProbeResult {
  detected: boolean;
  authOk: boolean;
  version: string | null;
}

export interface DoctorCheckInput {
  enabledProviders: ProviderId[];
  requiredPermissions: Partial<Record<ProviderId, Record<string, string>>>;
}

export interface DoctorCheckResult {
  overallOk: boolean;
  providers: Record<
    string,
    ProviderProbeResult & {
      compatible: boolean;
      ready: boolean;
      reason?: string;
    }
  >;
}

export class DoctorService {
  constructor(
    private readonly probe: (provider: ProviderId) => Promise<ProviderProbeResult>,
  ) {}

  async check(input: DoctorCheckInput): Promise<DoctorCheckResult> {
    const providers: DoctorCheckResult["providers"] = {};

    for (const provider of input.enabledProviders) {
      const probeResult = await this.probe(provider);
      const requiredPermissions = input.requiredPermissions[provider] ?? {};

      let compatible = true;
      let reason: string | undefined;
      try {
        normalizePermissions(provider, requiredPermissions, "strict");
      } catch (error) {
        compatible = false;
        reason = error instanceof Error ? error.message : "permission_enforcement_failed";
      }

      const definition = getProviderDefinition(provider);
      const ready = probeResult.detected && probeResult.authOk && compatible;
      providers[provider] = {
        ...probeResult,
        compatible,
        ready,
        reason: reason ?? (!probeResult.detected ? "not_detected" : !probeResult.authOk ? "auth_failed" : undefined),
      };

      void definition;
    }

    return {
      overallOk: Object.values(providers).every((provider) => provider.ready),
      providers,
    };
  }
}
