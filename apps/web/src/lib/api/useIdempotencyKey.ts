import { useMemo, useRef } from 'react';

/**
 * An Idempotency-Key per draft. Submitting the same draft again (a retry after a timeout or a
 * lost response) reuses its key, so the server creates it at most once; editing the draft, or
 * calling `reset()` after success, starts a new key.
 */
export function useIdempotencyKey() {
  const current = useRef<{ draft: string; key: string } | undefined>(undefined);
  return useMemo(
    () => ({
      for(draft: string): string {
        if (current.current?.draft !== draft) {
          current.current = { draft, key: crypto.randomUUID() };
        }
        return current.current.key;
      },
      reset(): void {
        current.current = undefined;
      },
    }),
    [],
  );
}
