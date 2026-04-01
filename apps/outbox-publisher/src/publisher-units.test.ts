import { sanitizeOutboxError } from '@dpp/database';
import { PublishError } from '@dpp/kafka';
import {
  KafkaJSConnectionError,
  KafkaJSNumberOfRetriesExceeded,
  KafkaJSProtocolError,
} from 'kafkajs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { computeBackoffMs } from './backoff.js';
import { classifyPublishFailure } from './classify.js';
import { loadPublisherConfig } from './config.js';

const policy = { baseMs: 1_000, maxMs: 60_000 };

describe('computeBackoffMs', () => {
  it('doubles the ceiling per attempt and jitters within [ceiling/2, ceiling]', () => {
    const ceilings = [1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000];
    ceilings.forEach((ceiling, i) => {
      expect(computeBackoffMs(i + 1, policy, () => 0)).toBe(ceiling / 2);
      expect(computeBackoffMs(i + 1, policy, () => 1)).toBe(ceiling);
    });
  });

  it('never exceeds the cap, even for huge attempt counts', () => {
    for (const attempt of [7, 50, 10_000]) {
      expect(computeBackoffMs(attempt, policy, Math.random)).toBeLessThanOrEqual(60_000);
    }
  });

  it('spreads retries of rows that failed together', () => {
    const delays = new Set(Array.from({ length: 50 }, () => computeBackoffMs(5, policy)));
    expect(delays.size).toBeGreaterThan(10);
  });
});

describe('classifyPublishFailure', () => {
  const wrapped = (cause: unknown) =>
    new PublishError('00000000-0000-4000-8000-000000000000', cause);

  it('treats connection failures and exhausted retries as Kafka being unavailable', () => {
    expect(classifyPublishFailure(wrapped(new KafkaJSConnectionError('refused')))).toBe(
      'kafka_unavailable',
    );
    const exhausted = new KafkaJSNumberOfRetriesExceeded(new KafkaJSConnectionError('refused'), {
      retryCount: 4,
      retryTime: 2000,
    });
    expect(classifyPublishFailure(wrapped(exhausted))).toBe('kafka_unavailable');
    expect(classifyPublishFailure(new Error('something else'))).toBe('kafka_unavailable');
  });

  it('treats an invalid stored event or a rejected message as specific to that event', () => {
    const zod = z.object({ a: z.string() }).safeParse({}).error!;
    expect(classifyPublishFailure(zod)).toBe('event_specific');
    const tooLarge = Object.assign(new KafkaJSProtocolError('too large'), {
      type: 'MESSAGE_TOO_LARGE',
    });
    expect(classifyPublishFailure(wrapped(tooLarge))).toBe('event_specific');
  });
});

describe('sanitizeOutboxError', () => {
  it('keeps one bounded line with the cause and no stack trace', () => {
    const err = new PublishError(
      'id',
      new KafkaJSConnectionError('Connection error: connect ECONNREFUSED'),
    );
    const text = sanitizeOutboxError(err);
    expect(text).toContain('PublishError');
    expect(text).toContain('ECONNREFUSED');
    expect(text).not.toContain('\n');
    expect(text).not.toMatch(/at \S+ \(/);
    expect(sanitizeOutboxError(new Error('x'.repeat(5_000))).length).toBeLessThanOrEqual(500);
  });
});

describe('publisher configuration', () => {
  const env = {
    PORT: '3002',
    DATABASE_URL: 'postgres://a:b@localhost:5432/c',
    KAFKA_BROKERS: 'localhost:9094',
    KAFKA_CLIENT_ID: 'outbox-publisher',
  };

  it('applies documented defaults', () => {
    expect(loadPublisherConfig(env)).toMatchObject({
      OUTBOX_BATCH_SIZE: 50,
      OUTBOX_POLL_INTERVAL_MS: 500,
      OUTBOX_LEASE_MS: 60_000,
      OUTBOX_BACKOFF_BASE_MS: 1_000,
      OUTBOX_BACKOFF_MAX_MS: 60_000,
    });
  });

  it('rejects unsafe values', () => {
    expect(() => loadPublisherConfig({ ...env, OUTBOX_BATCH_SIZE: '0' })).toThrow();
    expect(() => loadPublisherConfig({ ...env, OUTBOX_LEASE_MS: '10' })).toThrow();
    expect(() =>
      loadPublisherConfig({ ...env, OUTBOX_BACKOFF_BASE_MS: '5000', OUTBOX_BACKOFF_MAX_MS: '100' }),
    ).toThrow();
  });
});
