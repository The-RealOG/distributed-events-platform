const TIMED_OUT = Symbol('timed out');

export interface WaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
  /** Included in the timeout error so a failing test says what it was waiting for. */
  description?: string;
}

/**
 * Polls until `probe` returns a truthy value (or stops throwing) and returns it. Tests wait
 * on observable conditions with this instead of sleeping for a guessed duration.
 *
 * Each probe is raced against the remaining time: a probe that never settles (e.g. a client
 * connecting to a half-started server) must not stretch the wait past its deadline.
 */
export async function waitFor<T>(
  probe: () => T | Promise<T>,
  { timeoutMs = 20_000, intervalMs = 100, description = 'condition' }: WaitOptions = {},
): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  for (;;) {
    let timer: NodeJS.Timeout | undefined;
    try {
      const timedOut = new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), Math.max(1, deadline - Date.now()));
      });
      const value = await Promise.race([Promise.resolve().then(probe), timedOut]);
      if (value !== TIMED_OUT && value) return value;
    } catch (err) {
      lastError = err;
    } finally {
      clearTimeout(timer);
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for ${description}`, {
        cause: lastError,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
