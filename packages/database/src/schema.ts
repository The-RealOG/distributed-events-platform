import { sql } from 'drizzle-orm';
import type { DomainEvent } from '@dpp/contracts';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// All timestamps are timestamptz and written in UTC.
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const workspaceRole = pgEnum('workspace_role', ['OWNER', 'ADMIN', 'MEMBER']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: workspaceRole('role').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    // "Which workspaces am I in?" is the entry query for every session.
    index('workspace_members_user_id_idx').on(t.userId),
  ],
);

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('projects_workspace_id_idx').on(t.workspaceId)],
);

// One board per project today; kept as its own table so multiple boards can be added
// without reshaping tasks or columns.
export const boards = pgTable('boards', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .unique()
    .references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const boardColumns = pgTable(
  'board_columns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: numeric('position').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('board_columns_board_id_idx').on(t.boardId)],
);

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Denormalized from column → board → project so authorization and event keys
    // (projectId) don't require a three-table join on every task operation.
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    columnId: uuid('column_id')
      .notNull()
      .references(() => boardColumns.id),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    // Fractional ordering: a move writes one row instead of renumbering the column.
    position: numeric('position').notNull(),
    version: integer('version').notNull().default(1),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    // Soft delete keeps the row for activity history and late-arriving events.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('tasks_column_position_idx')
      .on(t.columnId, t.position)
      .where(sql`${t.deletedAt} is null`),
    index('tasks_project_id_idx').on(t.projectId),
    check('tasks_version_positive', sql`${t.version} >= 1`),
  ],
);

export const taskAssignees = pgTable(
  'task_assignees',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    assignedBy: uuid('assigned_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.userId] }),
    index('task_assignees_user_id_idx').on(t.userId),
  ],
);

export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    body: text('body').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('comments_task_id_created_at_idx').on(t.taskId, t.createdAt)],
);

/**
 * Transactional outbox (ADR-011). A row is written in the same transaction as the domain change
 * it describes, so a committed change always has a durable event waiting to be published.
 *
 * - `event` holds the complete DomainEvent exactly as built during the transaction. The
 *   publisher sends these bytes; it never rebuilds the event, so `eventId` is stable across
 *   every retry and republish.
 * - `sequenceId` is local publication order (monotonic, assigned by PostgreSQL). `eventId` is the
 *   event's global identity. Timestamps and UUIDs cannot order concurrent inserts; the
 *   sequence can.
 * - The other envelope columns are copies used by the publisher's queries and by diagnostics.
 */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    sequenceId: bigint('sequence_id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
    eventId: uuid('event_id').notNull().unique(),
    eventType: text('event_type').notNull(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    aggregateVersion: integer('aggregate_version').notNull(),
    partitionKey: text('partition_key').notNull(),
    correlationId: text('correlation_id').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    event: jsonb('event').$type<DomainEvent>().notNull(),
    createdAt: createdAt(),
    // Set only after Kafka acknowledged the event. Null means "still owed to Kafka".
    publishedAt: timestamp('published_at', { withTimezone: true }),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    lastError: text('last_error'),
    // Retry scheduling: a failed row is not eligible again until this time (backoff + jitter).
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    // Lease: which publisher currently owns the row, and until when. An expired lease (crashed
    // worker) makes the row claimable again.
    claimedBy: text('claimed_by'),
    claimedUntil: timestamp('claimed_until', { withTimezone: true }),
  },
  (t) => [
    // Publisher scan: unpublished rows in sequence order (the partial index stays small because
    // published rows drop out of it).
    index('outbox_events_unpublished_seq_idx')
      .on(t.sequenceId)
      .where(sql`${t.publishedAt} is null`),
    // Head-of-line check: "is there an earlier unpublished event for this partition key?"
    index('outbox_events_unpublished_key_seq_idx')
      .on(t.partitionKey, t.sequenceId)
      .where(sql`${t.publishedAt} is null`),
    // Retention: published rows by age (unpublished rows are never pruned, so they stay out).
    index('outbox_events_published_at_idx')
      .on(t.publishedAt)
      .where(sql`${t.publishedAt} is not null`),
    check('outbox_events_attempt_count_nonnegative', sql`${t.attemptCount} >= 0`),
  ],
);

/**
 * Idempotent consumption (ADR-013). A row means: this logical consumer's side effects for this
 * event have committed. It is written in the same transaction as those side effects, so the
 * marker and the effects exist together or not at all.
 *
 * Unique per (consumer, event), not per event: activity-service and cache-invalidator each
 * process every event once. `consumerName` is the stable logical name shared by all replicas
 * (never a host or process ID), and it doubles as the Kafka consumer group.
 *
 * Grows by one row per event per consumer; see ADR-013 for retention.
 */
export const processedEvents = pgTable(
  'processed_events',
  {
    consumerName: text('consumer_name').notNull(),
    eventId: uuid('event_id').notNull(),
    // Diagnostics only (what was processed, and when).
    eventType: text('event_type').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'processed_events_pkey', columns: [t.consumerName, t.eventId] }),
    check(
      'processed_events_consumer_name_format',
      sql`${t.consumerName} ~ '^[a-z][a-z0-9-]{1,62}$'`,
    ),
  ],
);

/**
 * Activity projection (ADR-014), written only by the Activity Service from domain events. One
 * row per event (UNIQUE event_id: a projection invariant; the duplicate-safe consumption itself
 * is processed_events, ADR-013). Structured `data`, not display text, so presentation can change.
 *
 * `id` is the persisted order: rows are inserted in consumption order, which for one project is
 * its partition order, i.e. its outbox (commit) order. The API pages newest-first by id.
 * No foreign keys: a projection mirrors events; it does not enforce the source's integrity.
 */
export const activityEvents = pgTable(
  'activity_events',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
    eventId: uuid('event_id').notNull().unique(),
    projectId: uuid('project_id').notNull(),
    eventType: text('event_type').notNull(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    aggregateVersion: integer('aggregate_version').notNull(),
    taskId: uuid('task_id').notNull(),
    actorId: uuid('actor_id').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),
    correlationId: text('correlation_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  // The API query: one project's history, newest first, cursor on id.
  (t) => [index('activity_events_project_id_idx').on(t.projectId, t.id.desc())],
);

/**
 * Attachment metadata (ADR-021). The bytes live in object storage under `objectKey`, a key the
 * server generates (never the user's file name). PostgreSQL and S3 cannot commit together, so:
 *
 *   pending  row created and a presigned upload issued; the object may or may not exist yet
 *   ready    the server verified the object (HEAD: exists, size within the declared limit)
 *   deleted  hidden from users; `objectDeletedAt` is set once the object is really gone
 *
 * A periodic sweep removes objects of abandoned uploads (pending too long) and retries object
 * deletion for deleted rows, so every divergence between the two stores converges.
 */
export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    projectId: uuid('project_id').notNull(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id),
    objectKey: text('object_key').notNull().unique(),
    originalFilename: text('original_filename').notNull(),
    contentType: text('content_type').notNull(),
    /** Declared at upload request; replaced by the stored object's size at finalization. */
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    status: text('status').notNull().default('pending'),
    createdAt: createdAt(),
    readyAt: timestamp('ready_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    objectDeletedAt: timestamp('object_deleted_at', { withTimezone: true }),
  },
  (t) => [
    check('attachments_status', sql`${t.status} in ('pending', 'ready', 'deleted')`),
    check('attachments_size_positive', sql`${t.sizeBytes} > 0`),
    index('attachments_task_ready_idx')
      .on(t.taskId)
      .where(sql`${t.status} = 'ready'`),
    // The sweep: abandoned pending uploads and deleted rows whose object is still there.
    index('attachments_sweep_idx')
      .on(t.status, t.createdAt)
      .where(
        sql`${t.status} = 'pending' or (${t.status} = 'deleted' and ${t.objectDeletedAt} is null)`,
      ),
  ],
);

/**
 * Idempotency keys for create requests (`Idempotency-Key` header). A key is claimed in the same
 * transaction as the change it protects and stores that change's response, so a retried request
 * either replays the committed response or, if the first attempt rolled back, runs again. Keys
 * belong to one user; they are deleted after IDEMPOTENCY_KEY_TTL_HOURS.
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    // SHA-256 of method, path and body: the same key with a different request is refused.
    requestHash: text('request_hash').notNull(),
    // Written in the claiming transaction, so they are never null once the row is visible.
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'idempotency_keys_pkey', columns: [t.userId, t.key] }),
    check('idempotency_keys_key_length', sql`length(${t.key}) between 1 and 255`),
    index('idempotency_keys_created_at_idx').on(t.createdAt),
  ],
);
