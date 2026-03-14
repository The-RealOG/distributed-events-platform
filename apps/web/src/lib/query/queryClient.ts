import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/errors';

/**
 * Reads are retried a couple of times, and only for transient failures (network, 503).
 * Mutations are never retried automatically: one that timed out may already have been
 * applied, and a 4xx will not change on retry.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        retry: (failureCount, error) =>
          failureCount < 2 &&
          error instanceof ApiError &&
          (error.kind === 'network' || error.kind === 'unavailable'),
      },
      mutations: { retry: false },
    },
  });
}
