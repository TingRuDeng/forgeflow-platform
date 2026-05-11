export type LeaseResourceType = "assignment";

export interface RuntimeLease {
  id: string;
  resourceType: LeaseResourceType;
  resourceId: string;
  ownerId: string;
  ownerToken: string;
  acquiredAt: string;
  renewedAt: string;
  expiresAt: string;
  releasedAt?: string | null;
  reclaimReason?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface AcquireLeaseInput {
  resourceType: LeaseResourceType;
  resourceId: string;
  ownerId: string;
  ownerToken: string;
  at: string;
  ttlMs: number;
  metadata?: Record<string, unknown> | null;
}

export interface AcquireLeaseResult {
  leases: RuntimeLease[];
  lease: RuntimeLease;
  acquired: boolean;
  conflictedWith?: RuntimeLease | null;
}

export interface ReleaseLeaseInput {
  resourceType: LeaseResourceType;
  resourceId: string;
  ownerId?: string | null;
  ownerToken?: string | null;
  at: string;
  reclaimReason?: string | null;
}

export interface ReleaseLeaseResult {
  leases: RuntimeLease[];
  releasedLease?: RuntimeLease | null;
}

export interface ReclaimedLease {
  lease: RuntimeLease;
  reason: string;
}

export interface ReclaimExpiredLeasesResult {
  leases: RuntimeLease[];
  reclaimed: ReclaimedLease[];
}

export const DEFAULT_LEASE_TTL_MS = 5 * 60_000;

export function buildLeaseId(resourceType: LeaseResourceType, resourceId: string): string {
  return `${resourceType}:${resourceId}`;
}

function parseTime(value: string | null | undefined): number {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function isReleased(lease: RuntimeLease): boolean {
  return Boolean(lease.releasedAt);
}

export function isLeaseExpired(lease: RuntimeLease, at: string): boolean {
  const expiresAt = parseTime(lease.expiresAt);
  const now = parseTime(at);
  if (!Number.isFinite(expiresAt) || !Number.isFinite(now)) {
    return false;
  }
  return expiresAt <= now;
}

export function listActiveLeases(leases: RuntimeLease[], at: string): RuntimeLease[] {
  return leases.filter((lease) => !isReleased(lease) && !isLeaseExpired(lease, at));
}

export function getActiveLease(
  leases: RuntimeLease[],
  resourceType: LeaseResourceType,
  resourceId: string,
  at: string,
): RuntimeLease | null {
  return listActiveLeases(leases, at).find((lease) =>
    lease.resourceType === resourceType && lease.resourceId === resourceId) ?? null;
}

export function acquireLease(
  leases: RuntimeLease[],
  input: AcquireLeaseInput,
): AcquireLeaseResult {
  const activeLease = getActiveLease(leases, input.resourceType, input.resourceId, input.at);
  if (activeLease) {
    if (activeLease.ownerId === input.ownerId && activeLease.ownerToken === input.ownerToken) {
      const renewedLease: RuntimeLease = {
        ...activeLease,
        renewedAt: input.at,
        expiresAt: new Date(Date.parse(input.at) + input.ttlMs).toISOString(),
        metadata: input.metadata ?? activeLease.metadata ?? null,
      };
      return {
        leases: leases.map((lease) => lease.id === renewedLease.id ? renewedLease : lease),
        lease: renewedLease,
        acquired: true,
        conflictedWith: null,
      };
    }
    return {
      leases,
      lease: activeLease,
      acquired: false,
      conflictedWith: activeLease,
    };
  }

  const lease: RuntimeLease = {
    id: buildLeaseId(input.resourceType, input.resourceId),
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    ownerId: input.ownerId,
    ownerToken: input.ownerToken,
    acquiredAt: input.at,
    renewedAt: input.at,
    expiresAt: new Date(Date.parse(input.at) + input.ttlMs).toISOString(),
    releasedAt: null,
    reclaimReason: null,
    metadata: input.metadata ?? null,
  };

  const existingIndex = leases.findIndex((candidate) => candidate.id === lease.id);
  if (existingIndex === -1) {
    return {
      leases: [...leases, lease],
      lease,
      acquired: true,
      conflictedWith: null,
    };
  }

  const next = [...leases];
  next[existingIndex] = lease;
  return {
    leases: next,
    lease,
    acquired: true,
    conflictedWith: null,
  };
}

export function releaseLease(
  leases: RuntimeLease[],
  input: ReleaseLeaseInput,
): ReleaseLeaseResult {
  const next = leases.map((lease) => {
    if (lease.resourceType !== input.resourceType || lease.resourceId !== input.resourceId) {
      return lease;
    }
    if (isReleased(lease)) {
      return lease;
    }
    if (input.ownerId && lease.ownerId !== input.ownerId) {
      return lease;
    }
    if (input.ownerToken && lease.ownerToken !== input.ownerToken) {
      return lease;
    }
    return {
      ...lease,
      releasedAt: input.at,
      reclaimReason: input.reclaimReason ?? lease.reclaimReason ?? null,
    };
  });

  const releasedLease = next.find((lease) =>
    lease.resourceType === input.resourceType
    && lease.resourceId === input.resourceId
    && lease.releasedAt === input.at
    && (!input.ownerId || lease.ownerId === input.ownerId)
    && (!input.ownerToken || lease.ownerToken === input.ownerToken)) ?? null;

  return {
    leases: next,
    releasedLease,
  };
}

export function reclaimExpiredLeases(
  leases: RuntimeLease[],
  at: string,
  reason = "expired",
): ReclaimExpiredLeasesResult {
  const reclaimed: ReclaimedLease[] = [];
  const next = leases.map((lease) => {
    if (isReleased(lease) || !isLeaseExpired(lease, at)) {
      return lease;
    }
    const reclaimedLease: RuntimeLease = {
      ...lease,
      releasedAt: at,
      reclaimReason: reason,
    };
    reclaimed.push({
      lease: reclaimedLease,
      reason,
    });
    return reclaimedLease;
  });

  return {
    leases: next,
    reclaimed,
  };
}
