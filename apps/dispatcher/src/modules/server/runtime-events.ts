import type { Event, RuntimeState } from "./runtime-state.js";

export const RUNTIME_EVENTS_RETENTION_LIMIT = 500;
export const DEFAULT_RUNTIME_AUDIT_EVENT_PAGE_LIMIT = 500;
export const MAX_RUNTIME_AUDIT_EVENT_PAGE_LIMIT = 5_000;

export interface RuntimeAuditEventQueryOptions {
  limit?: number;
  beforeSequence?: number;
}

export interface RuntimeAuditEventPage {
  events: Event[];
  total: number;
  limit: number;
  hasMore: boolean;
  nextBeforeSequence: number | null;
  scope: "durable_audit" | "runtime_window";
}

const EVENT_ID_PATTERN = /^event-(\d+)$/;

function parseEventSequence(eventId: string | undefined): number | null {
  const match = eventId?.match(EVENT_ID_PATTERN);
  if (!match) {
    return null;
  }
  const sequence = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(sequence) && sequence > 0 ? sequence : null;
}

export function ensureRuntimeEventIdentities(state: RuntimeState): RuntimeState {
  let eventSequence = Number.isSafeInteger(state.eventSequence) && (state.eventSequence ?? 0) >= 0
    ? state.eventSequence ?? 0
    : 0;

  for (const event of state.events) {
    eventSequence = Math.max(eventSequence, parseEventSequence(event.eventId) ?? 0);
  }

  let changed = state.eventSequence !== eventSequence;
  const usedEventIds = new Set<string>();
  const events = state.events.map((event) => {
    const eventId = event.eventId?.trim();
    if (eventId && !usedEventIds.has(eventId)) {
      usedEventIds.add(eventId);
      return event;
    }

    do {
      eventSequence += 1;
    } while (usedEventIds.has(`event-${eventSequence}`));

    const assignedEventId = `event-${eventSequence}`;
    usedEventIds.add(assignedEventId);
    changed = true;
    return {
      ...event,
      eventId: assignedEventId,
    };
  });

  if (!changed && state.eventSequence === eventSequence) {
    return state;
  }

  return {
    ...state,
    eventSequence,
    events,
  };
}

export function appendRuntimeEvent(
  state: RuntimeState,
  event: Event,
  retentionLimit = RUNTIME_EVENTS_RETENTION_LIMIT,
): RuntimeState {
  const normalizedState = ensureRuntimeEventIdentities(state);
  let eventSequence = normalizedState.eventSequence ?? 0;
  const usedEventIds = new Set(normalizedState.events.flatMap((candidate) =>
    candidate.eventId ? [candidate.eventId] : []
  ));

  let eventId = event.eventId?.trim();
  if (!eventId || usedEventIds.has(eventId)) {
    do {
      eventSequence += 1;
      eventId = `event-${eventSequence}`;
    } while (usedEventIds.has(eventId));
  } else {
    eventSequence = Math.max(eventSequence + 1, parseEventSequence(eventId) ?? 0);
  }

  const nextEvents = [
    ...normalizedState.events,
    {
      ...event,
      eventId,
    },
  ];

  return {
    ...normalizedState,
    eventSequence,
    events: nextEvents.length > retentionLimit
      ? nextEvents.slice(-retentionLimit)
      : nextEvents,
  };
}

export function describeRuntimeEventWindow(events: Event[]) {
  return {
    scope: "retained_runtime_events" as const,
    retentionLimit: RUNTIME_EVENTS_RETENTION_LIMIT,
    retainedCount: events.length,
    oldestAt: events[0]?.at ?? null,
    newestAt: events.at(-1)?.at ?? null,
  };
}

export function resolveRuntimeAuditEventPageLimit(limit: number | undefined): number {
  if (!Number.isSafeInteger(limit) || (limit ?? 0) <= 0) {
    return DEFAULT_RUNTIME_AUDIT_EVENT_PAGE_LIMIT;
  }
  return Math.min(limit ?? DEFAULT_RUNTIME_AUDIT_EVENT_PAGE_LIMIT, MAX_RUNTIME_AUDIT_EVENT_PAGE_LIMIT);
}

export function buildRuntimeEventWindowPage(
  events: Event[],
  options: RuntimeAuditEventQueryOptions = {},
): RuntimeAuditEventPage {
  const limit = resolveRuntimeAuditEventPageLimit(options.limit);
  const sequencedEvents = events.map((event, index) => ({
    ...event,
    auditSequence: parseEventSequence(event.eventId) ?? index + 1,
  }));
  const beforeSequence = options.beforeSequence;
  const eligibleEvents = beforeSequence !== undefined
    ? sequencedEvents.filter((event) => (event.auditSequence ?? 0) < beforeSequence)
    : sequencedEvents;
  const hasMore = eligibleEvents.length > limit;
  const pageEvents = eligibleEvents.slice(-limit);

  return {
    events: pageEvents,
    total: events.length,
    limit,
    hasMore,
    nextBeforeSequence: hasMore ? pageEvents[0]?.auditSequence ?? null : null,
    scope: "runtime_window",
  };
}
