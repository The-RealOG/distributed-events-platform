export * from './schema.js';
export {
  createDatabase,
  type Database,
  type DatabaseHandle,
  type DatabaseOptions,
  type DbExecutor,
} from './client.js';
export {
  isDatabaseUnavailable,
  pgErrorCode,
  PG_FOREIGN_KEY_VIOLATION,
  PG_UNIQUE_VIOLATION,
} from './errors.js';
export { runMigrations, MIGRATIONS_FOLDER, type MigrationOptions } from './migrate.js';
export { databaseTlsCaFromEnv } from './tls.js';
export {
  claimOutboxBatch,
  insertOutboxEvent,
  markOutboxPublished,
  outboxRecent,
  outboxStatus,
  recordOutboxFailure,
  releaseOutboxClaims,
  sanitizeOutboxError,
  type ClaimedOutboxEvent,
  type DbTransaction,
  type OutboxStatus,
} from './outbox.js';
export {
  assertConsumerName,
  CONSUMER_NAME,
  createIdempotentHandler,
  isEventProcessed,
  processEventOnce,
  type ConsumerLogger,
  type ConsumerOutcome,
  type DeliveryMetadata,
  type IdempotentHandlerOptions,
  type ProcessOutcome,
} from './idempotency.js';
// Consumers write their side effects with the transaction handle and this tag.
export { sql } from 'drizzle-orm';
export { projectReadAccess } from './access.js';
