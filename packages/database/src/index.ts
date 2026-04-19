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
