import type { DomainEvent } from '@dpp/contracts';

/**
 * Consumer failure handling (ADR-019).
 *
 * TRANSIENT: a dependency is unavailable (database or Redis connection, timeout, broker). Every
 *   event would fail the same way, so dead-lettering would just empty the stream into the DLQ.
 *   The partition waits instead: bounded in-process retries, then the error propagates, the
 *   offset stays uncommitted, and KafkaJS restarts from it. Order and events are preserved.
 * PERMANENT (poison): this event cannot be processed (constraint violation, invalid data,
 *   programming error). Retried a few times in case it was misclassified, then written to the
 *   DLQ, and only then acknowledged.
 */
export type FailureKind = 'transient' | 'permanent';

/** Throw this from a handler to declare an event unprocessable (goes to the DLQ). */
export class PermanentEventError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PermanentEventError';
  }
}

const TRANSIENT_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
]);
const TRANSIENT_MESSAGE =
  /timeout|timed out|connection (is )?(closed|terminated|refused|reset)|stream isn't writeable|getaddrinfo|socket hang up|too many clients|the database system is (starting|shutting) down|terminating connection/i;

export function classifyFailure(err: unknown): FailureKind {
  if (err instanceof PermanentEventError) return 'permanent';
  const e = err as { code?: unknown; message?: unknown; name?: unknown } | null;
  const code = typeof e?.code === 'string' ? e.code : '';
  // PostgreSQL SQLSTATE classes: 08 connection, 53 resources, 57 operator intervention (shutdown).
  if (/^(08|53|57)/.test(code) && code.length === 5) return 'transient';
  if (TRANSIENT_CODES.has(code)) return 'transient';
  if (typeof e?.name === 'string' && e.name.startsWith('KafkaJS')) return 'transient';
  if (typeof e?.message === 'string' && TRANSIENT_MESSAGE.test(e.message)) return 'transient';
  return 'permanent';
}

export interface RetryPolicy {
  /** Attempts for a permanent failure before it is dead-lettered (1 = no retry). */
  permanentAttempts: number;
  /** In-process attempts for a transient failure before handing back to KafkaJS. */
  transientAttempts: number;
  baseMs: number;
  maxMs: number;
}

export const DEFAULT_CONSUMER_RETRY: RetryPolicy = {
  permanentAttempts: 3,
  transientAttempts: 5,
  baseMs: 200,
  maxMs: 5_000,
};

/** Equal-jitter exponential backoff: uniform in [ceiling/2, ceiling], ceiling ≤ maxMs. */
export function retryDelayMs(
  attempt: number,
  policy: Pick<RetryPolicy, 'baseMs' | 'maxMs'>,
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(
    policy.maxMs,
    policy.baseMs * 2 ** Math.max(0, Math.min(attempt - 1, 20)),
  );
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

const MAX_ERROR_LENGTH = 500;
const REDACTIONS: [RegExp, string][] = [
  [/(postgres(ql)?|rediss?|amqp|mongodb):\/\/[^\s'"]+/gi, '$1://[redacted]'],
  [/bearer\s+[a-z0-9._~+/-]+=*/gi, 'Bearer [redacted]'],
  [/eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, '[jwt redacted]'],
  [/(A3T[A-Z0-9]|AKIA|ASIA)[A-Z0-9]{16}/g, '[aws key redacted]'],
  [/(password|secret|token)=([^\s&]+)/gi, '$1=[redacted]'],
];

/** One bounded line (name, code, message), no stack, credentials and tokens redacted. */
export function sanitizeError(err: unknown): string {
  const e = err as { name?: unknown; message?: unknown; code?: unknown } | null;
  const name = typeof e?.name === 'string' ? e.name : 'Error';
  const code = typeof e?.code === 'string' ? ` [${e.code}]` : '';
  const message = typeof e?.message === 'string' ? e.message : String(err);
  let text = `${name}${code}: ${message}`.replace(/\s+/g, ' ');
  for (const [pattern, replacement] of REDACTIONS) text = text.replace(pattern, replacement);
  return text.slice(0, MAX_ERROR_LENGTH);
}

export const DLQ_RECORD_VERSION = 1;

export type DlqCategory = 'poison' | 'malformed';

/** What the DLQ keeps about a failed message: enough to diagnose and to replay. */
export interface DlqRecord {
  dlqVersion: typeof DLQ_RECORD_VERSION;
  category: DlqCategory;
  consumer: string;
  error: string;
  attempts: number;
  failedAt: string;
  source: { topic: string; partition: number; offset: string; key: string | null };
  /** The original event, exactly as consumed (poison records). */
  event?: DomainEvent;
  /** Undecodable input, base64, truncated to 64 KiB (malformed records). */
  rawBase64?: string;
  rawTruncated?: boolean;
}

const MAX_RAW_BYTES = 64 * 1024;

export function rawForDlq(value: Buffer | null): Pick<DlqRecord, 'rawBase64' | 'rawTruncated'> {
  if (!value) return { rawBase64: '' };
  return {
    rawBase64: value.subarray(0, MAX_RAW_BYTES).toString('base64'),
    ...(value.length > MAX_RAW_BYTES ? { rawTruncated: true } : {}),
  };
}
