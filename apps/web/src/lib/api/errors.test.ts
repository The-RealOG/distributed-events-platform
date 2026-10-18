import { describe, expect, it } from 'vitest';
import { errorBody } from '../../test/fakeBackend';
import { ApiError, describeError, toApiError } from './errors';

describe('toApiError', () => {
  it('maps structured server errors to kinds, keeping the safe server message', () => {
    const err = toApiError(400, errorBody('VALIDATION_FAILED', 'Request validation failed'));
    expect(err).toMatchObject({
      kind: 'validation',
      status: 400,
      message: 'Request validation failed',
    });
    expect(toApiError(401, errorBody('TOKEN_EXPIRED', 'Token expired')).kind).toBe(
      'unauthenticated',
    );
    expect(toApiError(403, errorBody('FORBIDDEN', 'x')).kind).toBe('forbidden');
    expect(toApiError(404, errorBody('NOT_FOUND', 'x')).kind).toBe('not_found');
    expect(toApiError(503, errorBody('DEPENDENCY_UNAVAILABLE', 'x')).kind).toBe('unavailable');
    expect(toApiError(504, errorBody('OUTCOME_UNKNOWN', 'may have been applied'))).toMatchObject({
      kind: 'outcome_unknown',
      message: 'may have been applied',
    });
    expect(toApiError(429, errorBody('RATE_LIMITED', 'slow down')).kind).toBe('rate_limited');
    expect(toApiError(429, 'Too Many Requests').kind).toBe('rate_limited');
    expect(toApiError(409, errorBody('CONFLICT', 'dup')).kind).toBe('conflict');
  });

  it('distinguishes optimistic-concurrency conflicts and exposes the current version', () => {
    const err = toApiError(409, errorBody('VERSION_CONFLICT', 'changed', { currentVersion: 5 }));
    expect(err.kind).toBe('version_conflict');
    expect(err.currentVersion).toBe(5);
    expect(err.requestId).toBe('req-test');
  });

  it('never surfaces unstructured bodies (e.g. a proxy HTML page)', () => {
    const err = toApiError(502, '<html>nginx upstream error at 10.0.0.3</html>');
    expect(err.kind).toBe('unavailable');
    expect(err.message).not.toMatch(/nginx|10\.0\.0\.3/);
    expect(toApiError(418, undefined).kind).toBe('unexpected');
  });

  it('replaces internal-error messages with local wording', () => {
    const err = toApiError(500, errorBody('INTERNAL', 'Internal server error'));
    expect(err.kind).toBe('unexpected');
    expect(describeError(err)).toMatch(/unexpected/i);
  });

  it('gives each failure class its own user-facing text', () => {
    const kinds = ['forbidden', 'not_found', 'unavailable', 'network'] as const;
    const texts = kinds.map((kind) => describeError(new ApiError(kind, 'm', null)));
    expect(new Set(texts).size).toBe(kinds.length);
    expect(describeError(new Error('boom'))).not.toContain('boom');
  });
});
