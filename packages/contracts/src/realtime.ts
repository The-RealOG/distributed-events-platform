import { z } from 'zod';
import type { DomainEvent } from './events.js';

/**
 * Realtime WebSocket protocol (ADR-016). Notifications, not state: a client that receives one
 * refetches the affected data over HTTP, so a missed, duplicated or reordered notification
 * can never leave it wrong, only briefly stale.
 */

/** What a browser learns about a committed change. No infrastructure metadata (no offsets). */
export const realtimeEnvelope = z.object({
  type: z.string(),
  eventId: z.uuid(),
  projectId: z.uuid(),
  aggregateId: z.uuid(),
  aggregateVersion: z.number().int(),
  taskId: z.uuid(),
  actorId: z.uuid(),
  correlationId: z.string(),
  occurredAt: z.string(),
});
export type RealtimeEnvelope = z.infer<typeof realtimeEnvelope>;

export function toRealtimeEnvelope(event: DomainEvent): RealtimeEnvelope {
  return {
    type: event.eventType,
    eventId: event.eventId,
    projectId: event.payload.projectId,
    aggregateId: event.aggregateId,
    aggregateVersion: event.aggregateVersion,
    taskId: event.payload.taskId,
    actorId: event.payload.actorId,
    correlationId: event.correlationId,
    occurredAt: event.occurredAt,
  };
}

/** Browser → server. The first message must be `auth` (tokens never go in the URL). */
export const realtimeClientMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('auth'), token: z.string().min(1).max(4096) }),
  z.object({ type: z.literal('subscribe'), projectId: z.uuid() }),
  z.object({ type: z.literal('unsubscribe'), projectId: z.uuid() }),
]);
export type RealtimeClientMessage = z.infer<typeof realtimeClientMessage>;

export const realtimeErrorCode = z.enum([
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'BAD_MESSAGE',
  'UNAVAILABLE',
]);

/** Server → browser. */
export const realtimeServerMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), userId: z.uuid() }),
  z.object({ type: z.literal('subscribed'), projectId: z.uuid() }),
  z.object({ type: z.literal('event'), event: realtimeEnvelope }),
  z.object({
    type: z.literal('error'),
    code: realtimeErrorCode,
    message: z.string(),
    projectId: z.uuid().optional(),
  }),
]);
export type RealtimeServerMessage = z.infer<typeof realtimeServerMessage>;

/** WebSocket close codes used by the realtime service (4000–4999 are application codes). */
export const REALTIME_CLOSE = {
  unauthenticated: 4401,
  authTimeout: 4408,
  /** The client could not keep up; reconnect and refetch. */
  slowClient: 4429,
  /** Server shutting down (1001 "going away"); reconnect elsewhere. */
  goingAway: 1001,
} as const;
