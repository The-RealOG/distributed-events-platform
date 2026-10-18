// PostgreSQL SQLSTATE codes the application reacts to deliberately.
export const PG_UNIQUE_VIOLATION = '23505';
export const PG_FOREIGN_KEY_VIOLATION = '23503';

const CONNECTIVITY_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EAI_AGAIN',
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '08000', // connection_exception
  '08003', // connection_does_not_exist
  '08006', // connection_failure
  '53300', // too_many_connections
  // query_canceled: the server's statement_timeout cancelled the statement and its transaction
  // rolled back, so nothing was applied and a retry is safe. Consumers already treat class 57
  // as transient. (The client-side query timeout is different: the outcome is unknown, so it
  // stays a 500.)
  '57014',
]);

function findCode(err: unknown, depth = 0): string | undefined {
  if (depth > 5 || typeof err !== 'object' || err === null) return undefined;
  const { code, cause } = err as { code?: unknown; cause?: unknown };
  if (typeof code === 'string') return code;
  // Drizzle wraps driver errors; the SQLSTATE lives on the cause.
  return findCode(cause, depth + 1);
}

export function pgErrorCode(err: unknown): string | undefined {
  return findCode(err);
}

/**
 * True when node-postgres gave up waiting for a statement's response (its client-side
 * query_timeout). Unlike a server-side statement timeout, the statement may still have run and
 * committed, so the outcome of a mutation is unknown.
 */
export function isQueryTimeout(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e instanceof Error && depth <= 5; e = e.cause, depth++) {
    if (/^Query read timeout$/.test(e.message)) return true;
  }
  return false;
}

/**
 * True when the database could not be reached or could not answer in time, as opposed to the
 * query being rejected.
 * Callers map this to 503 so clients can distinguish "retry later" from "your request is wrong".
 */
export function isDatabaseUnavailable(err: unknown): boolean {
  const code = findCode(err);
  if (code !== undefined && CONNECTIVITY_ERROR_CODES.has(code)) return true;
  // pg-pool's acquisition timeout and node-postgres's terminated connections carry no code, and
  // Drizzle wraps them: the text is on a cause, never on DrizzleQueryError's own message.
  for (let e: unknown = err, depth = 0; e instanceof Error && depth <= 5; e = e.cause, depth++) {
    if (/timeout exceeded when trying to connect|Connection terminated/i.test(e.message))
      return true;
  }
  return false;
}
