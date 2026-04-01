export interface BackoffPolicy {
  baseMs: number;
  maxMs: number;
}

/**
 * Delay before retry number `attempt` (1 = after the first failure):
 *
 *   ceiling = min(maxMs, baseMs × 2^(attempt − 1))
 *   delay   = ceiling/2 + random × ceiling/2        ("equal jitter": uniform in [ceiling/2, ceiling])
 *
 * Exponential so an outage is not hammered; capped so recovery is noticed within maxMs;
 * jittered so many rows (or replicas) that failed together do not retry in lockstep.
 */
export function computeBackoffMs(
  attempt: number,
  policy: BackoffPolicy,
  random: () => number = Math.random,
): number {
  const exponent = Math.max(0, Math.min(attempt - 1, 30));
  const ceiling = Math.min(policy.maxMs, policy.baseMs * 2 ** exponent);
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}
