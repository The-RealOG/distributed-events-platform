import { drizzle, type NodePgDatabase, type NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import pg from 'pg';
import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;

/** Either the root database handle or an open transaction; repositories accept both. */
export type DbExecutor = PgDatabase<NodePgQueryResultHKT, typeof schema>;

export interface DatabaseOptions {
  connectionString: string;
  applicationName: string;
  maxConnections?: number;
  /** How long to wait for a pooled connection before failing, instead of queueing forever. */
  connectionTimeoutMs?: number;
  /** Server-side cap so a runaway query cannot hold a connection indefinitely. */
  statementTimeoutMs?: number;
  /**
   * Client-side cap on waiting for any query's response. The server-side statement timeout
   * cannot help when the server itself is unreachable or frozen (network partition, paused
   * host): without this, a query on an already-open connection waits forever.
   * Defaults to the statement timeout plus a margin, so the server's own timeout wins normally.
   */
  queryTimeoutMs?: number;
  /**
   * TLS with certificate verification against these CA certificates (PEM). Used for RDS, which
   * enforces TLS. Omitted locally, where the Compose PostgreSQL has no TLS.
   */
  tlsCaPem?: string | undefined;
  /** Idle clients can error (e.g. server restart); unhandled, that would crash the process. */
  onPoolError?: (err: Error) => void;
}

export interface DatabaseHandle {
  db: Database;
  pool: pg.Pool;
  ping(): Promise<void>;
  close(): Promise<void>;
}

export function createDatabase(options: DatabaseOptions): DatabaseHandle {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    application_name: options.applicationName,
    max: options.maxConnections ?? 10,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    statement_timeout: options.statementTimeoutMs ?? 10_000,
    query_timeout: options.queryTimeoutMs ?? (options.statementTimeoutMs ?? 10_000) + 5_000,
    ...(options.tlsCaPem ? { ssl: { ca: options.tlsCaPem, rejectUnauthorized: true } } : {}),
  });
  pool.on('error', (err) => options.onPoolError?.(err));

  return {
    db: drizzle(pool, { schema }),
    pool,
    async ping() {
      await pool.query('select 1');
    },
    async close() {
      await pool.end();
    },
  };
}
