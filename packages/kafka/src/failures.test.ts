import { describe, expect, it } from 'vitest';
import {
  classifyFailure,
  DEFAULT_CONSUMER_RETRY,
  PermanentEventError,
  rawForDlq,
  retryDelayMs,
  sanitizeError,
} from './failures.js';

const withCode = (message: string, code: string) => Object.assign(new Error(message), { code });

describe('failure classification', () => {
  it('treats dependency outages as transient', () => {
    for (const err of [
      withCode('connect ECONNREFUSED 10.0.0.1:5432', 'ECONNREFUSED'),
      withCode('the database system is shutting down', '57P03'),
      withCode('could not connect', '08006'),
      withCode('too many connections', '53300'),
      new Error('timeout exceeded when trying to connect'),
      new Error('Connection is closed.'),
      new Error("Stream isn't writeable and enableOfflineQueue options is false"),
      Object.assign(new Error('broker down'), { name: 'KafkaJSConnectionError' }),
    ]) {
      expect(classifyFailure(err), String(err)).toBe('transient');
    }
  });

  it('treats data/logic failures as permanent (poison)', () => {
    for (const err of [
      new PermanentEventError('cannot project this event'),
      withCode('duplicate key value violates unique constraint', '23505'),
      withCode('invalid input syntax for type uuid', '22P02'),
      new TypeError("Cannot read properties of undefined (reading 'x')"),
      new Error('something unexpected'),
    ]) {
      expect(classifyFailure(err), String(err)).toBe('permanent');
    }
  });
});

describe('retry delay', () => {
  it('grows exponentially, is capped, and is jittered within [ceiling/2, ceiling]', () => {
    const policy = { baseMs: 200, maxMs: 5_000 };
    expect([1, 2, 3, 4].map((a) => retryDelayMs(a, policy, () => 1))).toEqual([
      200, 400, 800, 1600,
    ]);
    expect([1, 2, 3, 4].map((a) => retryDelayMs(a, policy, () => 0))).toEqual([100, 200, 400, 800]);
    expect(retryDelayMs(50, policy, () => 1)).toBe(5_000);
    expect(retryDelayMs(1_000, policy, () => 1)).toBe(5_000);
    const spread = new Set(Array.from({ length: 50 }, () => retryDelayMs(3, policy)));
    expect(spread.size).toBeGreaterThan(10);
  });

  it('defaults are bounded: poison is dead-lettered after 3 attempts, total wait under 1 s', () => {
    expect(DEFAULT_CONSUMER_RETRY.permanentAttempts).toBe(3);
    const worst = [1, 2].reduce(
      (sum, a) => sum + retryDelayMs(a, DEFAULT_CONSUMER_RETRY, () => 1),
      0,
    );
    expect(worst).toBeLessThan(1_000);
  });
});

describe('DLQ error sanitising', () => {
  it('keeps one bounded line without stack traces or credentials', () => {
    const err = withCode(
      'connect to postgres://app:s3cret@db.internal:5432/dpp failed; Authorization: Bearer abc.def.ghi; ' +
        'token=xyz AKIAABCDEFGHIJKLMNOP eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N' +
        `\n${'x'.repeat(2000)}`,
      '08006',
    );
    const text = sanitizeError(err);
    expect(text.length).toBeLessThanOrEqual(500);
    expect(text).not.toMatch(/s3cret|abc\.def|xyz|AKIAABCDEFGHIJKLMNOP|eyJzdWIi|\n|at /);
    expect(text).toContain('[08006]');
  });

  it('keeps malformed input as bounded base64', () => {
    expect(rawForDlq(Buffer.from('not json'))).toEqual({
      rawBase64: Buffer.from('not json').toString('base64'),
    });
    const big = rawForDlq(Buffer.alloc(100 * 1024, 1));
    expect(big.rawTruncated).toBe(true);
    expect(Buffer.from(big.rawBase64!, 'base64').length).toBe(64 * 1024);
  });
});
