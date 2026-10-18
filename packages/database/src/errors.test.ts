import { describe, expect, it } from 'vitest';
import {
  isDatabaseUnavailable,
  isQueryTimeout,
  pgErrorCode,
  PG_UNIQUE_VIOLATION,
} from './errors.js';

const withCode = (code: string) => Object.assign(new Error('x'), { code });

describe('database error classification', () => {
  it('finds SQLSTATE codes on wrapped driver errors', () => {
    const wrapped = new Error('query failed', { cause: withCode(PG_UNIQUE_VIOLATION) });
    expect(pgErrorCode(wrapped)).toBe(PG_UNIQUE_VIOLATION);
  });

  it('treats connectivity failures as unavailable', () => {
    expect(isDatabaseUnavailable(withCode('ECONNREFUSED'))).toBe(true);
    expect(isDatabaseUnavailable(withCode('57P01'))).toBe(true);
    expect(isDatabaseUnavailable(new Error('timeout exceeded when trying to connect'))).toBe(true);
    expect(isDatabaseUnavailable(new Error('x', { cause: withCode('08006') }))).toBe(true);
  });

  it('sees pool and connection failures that Drizzle wrapped (no code, text only on the cause)', () => {
    // The shape seen on AWS under pool exhaustion (2026-10-17): DrizzleQueryError's own message
    // is "Failed query: …"; pg-pool's error is its cause and carries no code.
    const drizzle = (cause: Error) =>
      Object.assign(new Error('Failed query: select "id" from "projects"\nparams: x', { cause }), {
        name: 'DrizzleQueryError',
      });
    expect(
      isDatabaseUnavailable(drizzle(new Error('timeout exceeded when trying to connect'))),
    ).toBe(true);
    expect(
      isDatabaseUnavailable(
        drizzle(
          new Error('Connection terminated due to connection timeout', {
            cause: new Error('Connection terminated unexpectedly'),
          }),
        ),
      ),
    ).toBe(true);
    expect(isDatabaseUnavailable(drizzle(withCode(PG_UNIQUE_VIOLATION)))).toBe(false);
  });

  it('treats a server-side statement timeout as unavailable, but not an unknown-outcome client timeout', () => {
    const drizzle = (cause: Error) =>
      Object.assign(new Error('Failed query: update "tasks" set …\nparams: x', { cause }), {
        name: 'DrizzleQueryError',
      });
    // statement_timeout: PostgreSQL cancelled and rolled back, so retrying is safe.
    expect(isDatabaseUnavailable(drizzle(withCode('57014')))).toBe(true);
    // node-postgres query_timeout: the statement may still have committed.
    expect(isDatabaseUnavailable(drizzle(new Error('Query read timeout')))).toBe(false);
  });

  it('does not treat rejected queries as unavailability', () => {
    expect(isDatabaseUnavailable(withCode(PG_UNIQUE_VIOLATION))).toBe(false);
    expect(isDatabaseUnavailable(new Error('syntax error'))).toBe(false);
    expect(isDatabaseUnavailable(undefined)).toBe(false);
  });

  it('recognises the client-side query timeout, whose outcome is unknown, and nothing else', () => {
    const wrapped = new Error('Failed query: commit', { cause: new Error('Query read timeout') });
    expect(isQueryTimeout(wrapped)).toBe(true);
    expect(isQueryTimeout(new Error('x', { cause: withCode('57014') }))).toBe(false);
    expect(isQueryTimeout(new Error('timeout exceeded when trying to connect'))).toBe(false);
  });
});
