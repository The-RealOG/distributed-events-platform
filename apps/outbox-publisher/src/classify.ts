import { ZodError } from 'zod';

/**
 * What a failed publish says about what to do next:
 * - `event_specific`: this event cannot be published as it is (invalid stored event, message
 *   rejected as too large or corrupt). Record it and keep going with the rest of the batch.
 * - `kafka_unavailable`: anything else, including connection failures, timeouts and exhausted
 *   KafkaJS retries. The next event would almost certainly fail the same way, so stop the batch
 *   and back off rather than burn an attempt on every row during an outage.
 */
export type PublishFailureKind = 'event_specific' | 'kafka_unavailable';

const EVENT_SPECIFIC_KAFKA_ERRORS = new Set([
  'MESSAGE_TOO_LARGE',
  'INVALID_RECORD',
  'CORRUPT_MESSAGE',
  'RECORD_LIST_TOO_LARGE',
]);

function causes(error: unknown): unknown[] {
  const chain: unknown[] = [];
  let current = error;
  for (let depth = 0; current !== undefined && current !== null && depth < 6; depth++) {
    chain.push(current);
    const next = current as { cause?: unknown; originalError?: unknown };
    current = next.originalError ?? next.cause;
  }
  return chain;
}

export function classifyPublishFailure(error: unknown): PublishFailureKind {
  for (const e of causes(error)) {
    if (e instanceof ZodError) return 'event_specific';
    const type = (e as { type?: unknown }).type;
    if (typeof type === 'string' && EVENT_SPECIFIC_KAFKA_ERRORS.has(type)) return 'event_specific';
  }
  return 'kafka_unavailable';
}
