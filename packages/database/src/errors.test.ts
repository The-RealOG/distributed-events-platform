import { describe, expect, it } from 'vitest';
import { isDatabaseUnavailable, pgErrorCode, PG_UNIQUE_VIOLATION } from './errors.js';

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

  it('does not treat rejected queries as unavailability', () => {
    expect(isDatabaseUnavailable(withCode(PG_UNIQUE_VIOLATION))).toBe(false);
    expect(isDatabaseUnavailable(new Error('syntax error'))).toBe(false);
    expect(isDatabaseUnavailable(undefined)).toBe(false);
  });
});
