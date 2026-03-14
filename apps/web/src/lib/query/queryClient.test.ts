import { describe, expect, it } from 'vitest';
import { ApiError, type ApiErrorKind } from '../api/errors';
import { createQueryClient } from './queryClient';

const retry = createQueryClient().getDefaultOptions().queries!.retry as (
  count: number,
  error: unknown,
) => boolean;
const err = (kind: ApiErrorKind) => new ApiError(kind, 'm', null);

describe('query retry policy', () => {
  it('retries reads only for transient failures, at most twice', () => {
    expect(retry(0, err('unavailable'))).toBe(true);
    expect(retry(1, err('network'))).toBe(true);
    expect(retry(2, err('network'))).toBe(false);
    for (const kind of [
      'validation',
      'unauthenticated',
      'forbidden',
      'not_found',
      'version_conflict',
    ] as const) {
      expect(retry(0, err(kind))).toBe(false);
    }
  });

  it('never retries mutations', () => {
    expect(createQueryClient().getDefaultOptions().mutations!.retry).toBe(false);
  });
});
