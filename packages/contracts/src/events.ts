import { z } from 'zod';

/**
 * Domain events carried over Kafka (topic `domain.events`).
 *
 * Kafka payloads are external input to every consumer: they are validated at runtime with
 * these schemas, never trusted because "we produced them".
 *
 * Versioning: `schemaVersion` is the version of this *event format*. It is unrelated to
 * `aggregateVersion`, the optimistic-concurrency version of the task after the change.
 */

export const EVENT_SCHEMA_VERSION = 1;
export const SUPPORTED_SCHEMA_VERSIONS = [1] as const;

// Same rule the HTTP layer applies to x-correlation-id, so an ID accepted at the gateway is
// always a valid event correlationId.
const traceId = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/, 'must be 1-128 safe characters');
// Canonical instant representation: ISO-8601 in UTC with a trailing Z.
const utcTimestamp = z.iso.datetime({ offset: false });
// Task positions are PostgreSQL NUMERIC values carried as decimal strings (no float rounding).
const decimalString = z.string().regex(/^-?\d+(\.\d+)?$/, 'must be a decimal string');

const envelopeBase = z.object({
  eventId: z.uuid(),
  eventType: z.string().min(1),
  aggregateType: z.string().min(1),
  aggregateId: z.uuid(),
  aggregateVersion: z.number().int().min(1),
  occurredAt: utcTimestamp,
  producer: z.string().min(1).max(64),
  correlationId: traceId,
  causationId: traceId.optional(),
  schemaVersion: z.number().int().min(1),
  payload: z.unknown(),
});

/** Fields every project-scoped payload carries: the partition key and who did it. */
const projectScoped = { projectId: z.uuid(), actorId: z.uuid() };

// Task title is included (bounded, as in the tasks table) so consumers such as activity and
// notifications can render "Ada moved *Write spec*" without calling back to the Project
// Service. Descriptions (up to 20k chars) and comment bodies (up to 10k) are not copied.
const title = z.string().min(1).max(500);

export const taskCreatedPayload = z.object({
  ...projectScoped,
  taskId: z.uuid(),
  columnId: z.uuid(),
  title,
  position: decimalString,
});

export const taskUpdatedPayload = z
  .object({
    ...projectScoped,
    taskId: z.uuid(),
    title: z.object({ previous: title, current: title }).optional(),
    // Only whether it changed: descriptions can be large, and consumers re-read the task.
    descriptionChanged: z.boolean(),
  })
  .refine((p) => p.title !== undefined || p.descriptionChanged, {
    message: 'an update must change the title or the description',
  });

export const taskMovedPayload = z.object({
  ...projectScoped,
  taskId: z.uuid(),
  title,
  fromColumnId: z.uuid(),
  toColumnId: z.uuid(),
  // New fractional position in the target column (same column = reorder).
  position: decimalString,
});

export const taskDeletedPayload = z.object({
  ...projectScoped,
  taskId: z.uuid(),
  title,
  columnId: z.uuid(),
});

export const taskAssignmentPayload = z.object({
  ...projectScoped,
  taskId: z.uuid(),
  title,
  assigneeId: z.uuid(),
});

export const commentCreatedPayload = z.object({
  ...projectScoped,
  commentId: z.uuid(),
  taskId: z.uuid(),
  taskTitle: title,
  // A bounded excerpt for notifications/activity; the full body stays in PostgreSQL.
  excerpt: z.string().max(280),
  bodyLength: z.number().int().min(1),
});

function eventSchema<
  const Type extends string,
  const Aggregate extends 'task' | 'comment',
  P extends z.ZodType,
>(eventType: Type, aggregateType: Aggregate, payload: P) {
  return envelopeBase.extend({
    eventType: z.literal(eventType),
    aggregateType: z.literal(aggregateType),
    schemaVersion: z.literal(EVENT_SCHEMA_VERSION),
    payload,
  });
}

export const domainEventSchema = z
  .discriminatedUnion('eventType', [
    eventSchema('task.created', 'task', taskCreatedPayload),
    eventSchema('task.updated', 'task', taskUpdatedPayload),
    eventSchema('task.moved', 'task', taskMovedPayload),
    eventSchema('task.deleted', 'task', taskDeletedPayload),
    eventSchema('task.assigned', 'task', taskAssignmentPayload),
    eventSchema('task.unassigned', 'task', taskAssignmentPayload),
    eventSchema('comment.created', 'comment', commentCreatedPayload),
  ])
  // The aggregate named in the envelope must be the entity the payload describes.
  .superRefine((event, ctx) => {
    const expected =
      event.aggregateType === 'comment' ? event.payload.commentId : event.payload.taskId;
    if (event.aggregateId !== expected) {
      ctx.addIssue({
        code: 'custom',
        path: ['aggregateId'],
        message: `aggregateId must equal the payload's ${event.aggregateType} id`,
      });
    }
  });

export type DomainEvent = z.infer<typeof domainEventSchema>;
export type DomainEventType = DomainEvent['eventType'];
export type EventOf<T extends DomainEventType> = Extract<DomainEvent, { eventType: T }>;
export type PayloadOf<T extends DomainEventType> = EventOf<T>['payload'];

export const DOMAIN_EVENT_TYPES = [
  'task.created',
  'task.updated',
  'task.moved',
  'task.deleted',
  'task.assigned',
  'task.unassigned',
  'comment.created',
] as const satisfies readonly DomainEventType[];

const AGGREGATE_TYPE: Record<DomainEventType, 'task' | 'comment'> = {
  'task.created': 'task',
  'task.updated': 'task',
  'task.moved': 'task',
  'task.deleted': 'task',
  'task.assigned': 'task',
  'task.unassigned': 'task',
  'comment.created': 'comment',
};

/** Kafka message key for an event: all current events are project-scoped. */
export function partitionKeyOf(event: DomainEvent): string {
  return event.payload.projectId;
}

// ---------------------------------------------------------------------------------------------
// Parsing: classify rather than just "valid / invalid", so consumers can log and route each
// kind of bad message deliberately (and later send some to the DLQ).

export type EventParseFailure =
  | { ok: false; reason: 'invalid_json' }
  | { ok: false; reason: 'invalid_envelope'; issues: string[]; eventId?: string }
  | { ok: false; reason: 'unsupported_schema_version'; schemaVersion: number; eventId?: string }
  | { ok: false; reason: 'unknown_event_type'; eventType: string; eventId?: string }
  | { ok: false; reason: 'invalid_payload'; issues: string[]; eventId?: string; eventType: string };

export type EventParseResult = { ok: true; event: DomainEvent } | EventParseFailure;

const issuesOf = (error: z.ZodError) =>
  error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);

/** Validates an already-decoded JSON value as a DomainEvent, classifying any failure. */
export function parseDomainEvent(value: unknown): EventParseResult {
  const envelope = envelopeBase.safeParse(value);
  if (!envelope.success) {
    const maybeId = (value as { eventId?: unknown } | null)?.eventId;
    return {
      ok: false,
      reason: 'invalid_envelope',
      issues: issuesOf(envelope.error),
      ...(typeof maybeId === 'string' && z.uuid().safeParse(maybeId).success
        ? { eventId: maybeId }
        : {}),
    };
  }
  const { eventId, eventType, schemaVersion } = envelope.data;
  // Checked before the type: a future format must never be read with today's schema.
  if (!(SUPPORTED_SCHEMA_VERSIONS as readonly number[]).includes(schemaVersion)) {
    return { ok: false, reason: 'unsupported_schema_version', schemaVersion, eventId };
  }
  if (!(DOMAIN_EVENT_TYPES as readonly string[]).includes(eventType)) {
    return { ok: false, reason: 'unknown_event_type', eventType, eventId };
  }
  const full = domainEventSchema.safeParse(value);
  if (!full.success) {
    return {
      ok: false,
      reason: 'invalid_payload',
      issues: issuesOf(full.error),
      eventId,
      eventType,
    };
  }
  return { ok: true, event: full.data };
}

/** Decodes raw Kafka message bytes (UTF-8 JSON) and validates them. */
export function decodeDomainEvent(bytes: Uint8Array | string | null): EventParseResult {
  if (bytes === null) return { ok: false, reason: 'invalid_json' };
  let value: unknown;
  try {
    value = JSON.parse(typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes));
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
  return parseDomainEvent(value);
}

// ---------------------------------------------------------------------------------------------
// Construction: the only way application code should create events. Metadata is filled in
// here and the result is validated, so an invalid event fails at the producer, not at every
// consumer.

export interface EventContext {
  /** Service name, e.g. "project-service". */
  producer: string;
  /** The correlation ID of the operation that caused this event, unchanged. */
  correlationId: string;
  causationId?: string;
}

export interface EventOptions {
  /** Deterministic overrides for tests; production uses a random UUID and the current time. */
  eventId?: string;
  now?: Date;
}

export function createDomainEvent<T extends DomainEventType>(
  eventType: T,
  context: EventContext,
  aggregate: { id: string; version: number },
  payload: PayloadOf<T>,
  options: EventOptions = {},
): EventOf<T> {
  const candidate = {
    eventId: options.eventId ?? globalThis.crypto.randomUUID(),
    eventType,
    aggregateType: AGGREGATE_TYPE[eventType],
    aggregateId: aggregate.id,
    aggregateVersion: aggregate.version,
    occurredAt: (options.now ?? new Date()).toISOString(),
    producer: context.producer,
    correlationId: context.correlationId,
    ...(context.causationId === undefined ? {} : { causationId: context.causationId }),
    schemaVersion: EVENT_SCHEMA_VERSION,
    payload,
  };
  return domainEventSchema.parse(candidate) as EventOf<T>;
}

/** Task after a mutation, as the Project Service has it (see tasks table). */
export interface TaskSnapshot {
  id: string;
  projectId: string;
  columnId: string;
  title: string;
  position: string;
  version: number;
}

export const taskEvents = {
  created: (ctx: EventContext, actorId: string, task: TaskSnapshot, options?: EventOptions) =>
    createDomainEvent(
      'task.created',
      ctx,
      task,
      {
        projectId: task.projectId,
        actorId,
        taskId: task.id,
        columnId: task.columnId,
        title: task.title,
        position: task.position,
      },
      options,
    ),

  updated: (
    ctx: EventContext,
    actorId: string,
    before: Pick<TaskSnapshot, 'title'> & { description: string },
    after: TaskSnapshot & { description: string },
    options?: EventOptions,
  ) =>
    createDomainEvent(
      'task.updated',
      ctx,
      after,
      {
        projectId: after.projectId,
        actorId,
        taskId: after.id,
        ...(before.title === after.title
          ? {}
          : { title: { previous: before.title, current: after.title } }),
        descriptionChanged: before.description !== after.description,
      },
      options,
    ),

  moved: (
    ctx: EventContext,
    actorId: string,
    fromColumnId: string,
    after: TaskSnapshot,
    options?: EventOptions,
  ) =>
    createDomainEvent(
      'task.moved',
      ctx,
      after,
      {
        projectId: after.projectId,
        actorId,
        taskId: after.id,
        title: after.title,
        fromColumnId,
        toColumnId: after.columnId,
        position: after.position,
      },
      options,
    ),

  deleted: (ctx: EventContext, actorId: string, after: TaskSnapshot, options?: EventOptions) =>
    createDomainEvent(
      'task.deleted',
      ctx,
      after,
      {
        projectId: after.projectId,
        actorId,
        taskId: after.id,
        title: after.title,
        columnId: after.columnId,
      },
      options,
    ),

  assigned: (
    ctx: EventContext,
    actorId: string,
    after: TaskSnapshot,
    assigneeId: string,
    options?: EventOptions,
  ) =>
    createDomainEvent(
      'task.assigned',
      ctx,
      after,
      { projectId: after.projectId, actorId, taskId: after.id, title: after.title, assigneeId },
      options,
    ),

  unassigned: (
    ctx: EventContext,
    actorId: string,
    after: TaskSnapshot,
    assigneeId: string,
    options?: EventOptions,
  ) =>
    createDomainEvent(
      'task.unassigned',
      ctx,
      after,
      { projectId: after.projectId, actorId, taskId: after.id, title: after.title, assigneeId },
      options,
    ),
};

const EXCERPT_LENGTH = 280;

export const commentEvents = {
  created: (
    ctx: EventContext,
    comment: { id: string; taskId: string; authorId: string; body: string },
    task: { projectId: string; title: string },
    options?: EventOptions,
  ) =>
    createDomainEvent(
      'comment.created',
      ctx,
      // Comments are immutable, so their aggregate version is always 1.
      { id: comment.id, version: 1 },
      {
        projectId: task.projectId,
        actorId: comment.authorId,
        commentId: comment.id,
        taskId: comment.taskId,
        taskTitle: task.title,
        excerpt: comment.body.slice(0, EXCERPT_LENGTH),
        bodyLength: comment.body.length,
      },
      options,
    ),
};
