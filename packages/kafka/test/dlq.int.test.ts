import { randomUUID } from 'node:crypto';
import type { DomainEvent } from '@dpp/contracts';
import { waitFor } from '@dpp/test-utils';
import { describe, expect, it } from 'vitest';
import {
  DomainEventConsumer,
  DomainEventProducer,
  PermanentEventError,
  readDeadLetters,
  replayDeadLetters,
  type DomainEventConsumerOptions,
} from '../src/index.js';
import { captureLogger, createTestTopic, kafkaClient, sampleEvent } from './support.js';

/**
 * Bounded retries and the DLQ (ADR-019) against a real broker. Every test uses its own source
 * and DLQ topics.
 */
const fast = { permanentAttempts: 3, transientAttempts: 3, baseMs: 20, maxMs: 100 };

async function setup() {
  const { logger, lines } = captureLogger();
  const kafka = kafkaClient(logger);
  const [topic, dlqTopic] = [await createTestTopic(kafka), await createTestTopic(kafka, 1)];
  const publish = async (...events: DomainEvent[]) => {
    const producer = new DomainEventProducer({ kafka, logger, topic });
    await producer.connect();
    for (const e of events) await producer.publish(e);
    await producer.close();
  };
  const start = async (
    handler: DomainEventConsumerOptions['handler'],
    extra: Partial<DomainEventConsumerOptions> = {},
    groupId = `dlq-test-${randomUUID()}`,
  ) => {
    const consumer = new DomainEventConsumer({
      kafka,
      logger,
      groupId,
      topics: [topic],
      fromBeginning: true,
      deadLetter: { topic: dlqTopic },
      retry: fast,
      handler,
      ...extra,
    });
    const joined = consumer.nextGroupJoin();
    await consumer.start();
    await joined;
    return consumer;
  };
  return { kafka, logger, lines, topic, dlqTopic, publish, start };
}

describe('bounded retries and dead-lettering (real broker)', () => {
  it('a transient failure is retried and then succeeds; nothing is dead-lettered', async () => {
    const t = await setup();
    const event = sampleEvent(randomUUID());
    let calls = 0;
    const done: string[] = [];
    const consumer = await t.start(async (e) => {
      calls++;
      if (calls < 3)
        throw Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:5432'), {
          code: 'ECONNREFUSED',
        });
      done.push(e.eventId);
    });
    await t.publish(event);
    await waitFor(() => done.length === 1, { description: 'processed after retries' });
    await consumer.stop();
    expect(calls).toBe(3);
    expect(await readDeadLetters(t.kafka, { topic: t.dlqTopic })).toEqual([]);
  });

  it('a poison event is tried exactly permanentAttempts times, dead-lettered with diagnostics, then acknowledged; the next event still flows', async () => {
    const t = await setup();
    const projectId = randomUUID();
    const [poison, next] = [sampleEvent(projectId), sampleEvent(projectId)];
    const attempts = new Map<string, number>();
    const done: string[] = [];
    const retries: number[] = [];
    const consumer = await t.start(
      async (e) => {
        attempts.set(e.eventId, (attempts.get(e.eventId) ?? 0) + 1);
        if (e.eventId === poison.eventId) {
          throw new PermanentEventError(
            'cannot apply: postgres://app:hunter2@db/x said no (Bearer eyJhbGciOi.xxxxxxxxxxxx.yyyyyyyyyyyy)',
          );
        }
        done.push(e.eventId);
      },
      { hooks: { onRetry: (_k, _a, delayMs) => retries.push(delayMs) } },
    );
    await t.publish(poison, next);
    await waitFor(() => done.includes(next.eventId), { description: 'the next event processed' });
    await consumer.stop();

    expect(attempts.get(poison.eventId)).toBe(3);
    expect(retries).toHaveLength(2);
    for (const d of retries) expect(d).toBeLessThanOrEqual(100);

    const [letter, ...more] = await readDeadLetters(t.kafka, { topic: t.dlqTopic });
    expect(more).toEqual([]);
    expect(letter!.record).toMatchObject({
      category: 'poison',
      attempts: 3,
      event: poison,
      source: {
        topic: t.topic,
        partition: expect.any(Number),
        offset: expect.any(String),
        key: projectId,
      },
      failedAt: expect.any(String),
    });
    expect(letter!.record.consumer).toMatch(/^dlq-test-/);
    expect(letter!.record.error).toContain('PermanentEventError');
    expect(letter!.record.error).not.toMatch(/hunter2|eyJhbGciOi\.x/);

    // Acknowledged: a new consumer in the same group does not get the poison event again.
    const again: string[] = [];
    const second = await t.start(
      async (e) => void again.push(e.eventId),
      {},
      letter!.record.consumer,
    );
    await new Promise((r) => setTimeout(r, 1_500));
    await second.stop();
    expect(again).toEqual([]);
  });

  it('malformed input is dead-lettered for visibility (never silently lost), with bounded raw bytes', async () => {
    const t = await setup();
    const raw = t.kafka.producer();
    await raw.connect();
    await raw.send({ topic: t.topic, messages: [{ key: 'k', value: '{ not json' }] });
    await raw.disconnect();
    const consumer = await t.start(async () => {});
    const letters = await waitFor(
      async () => {
        const l = await readDeadLetters(t.kafka, { topic: t.dlqTopic });
        return l.length > 0 ? l : undefined;
      },
      { timeoutMs: 30_000, description: 'malformed record dead-lettered' },
    );
    await consumer.stop();
    expect(letters[0]!.record).toMatchObject({ category: 'malformed', error: 'invalid_json' });
    expect(Buffer.from(letters[0]!.record.rawBase64!, 'base64').toString()).toBe('{ not json');
  });

  it('if the DLQ cannot be written, the source event is NOT acknowledged and is redelivered later', async () => {
    const t = await setup();
    const event = sampleEvent(randomUUID());
    const groupId = `dlq-test-${randomUUID()}`;
    let calls = 0;
    // DLQ topic that does not exist (auto-creation is off): every dead-letter write fails.
    const broken = await t.start(
      async () => {
        calls++;
        throw new PermanentEventError('poison');
      },
      { deadLetter: { topic: `missing.${randomUUID()}` } },
      groupId,
    );
    await t.publish(event);
    await waitFor(() => calls >= 3, { timeoutMs: 60_000, description: 'retries exhausted once' });
    await broken.stop();

    // A healthy replica of the same group gets the same event again (offset was not committed).
    const redelivered: string[] = [];
    const healthy = await t.start(async (e) => void redelivered.push(e.eventId), {}, groupId);
    await waitFor(() => redelivered.includes(event.eventId), {
      timeoutMs: 60_000,
      description: 'redelivery of the unacknowledged event',
    });
    await healthy.stop();
  });

  it('a NON-retriable DLQ failure (like MSK authorization) does not stop the consumer: the event keeps being redelivered', async () => {
    // Found on AWS: without DLQ write permission, KafkaJS got a non-retriable error from the
    // handler path, crashed the consumer for good, and the process stayed up (silently dead).
    const t = await setup();
    let calls = 0;
    const consumer = await t.start(
      async () => {
        calls++;
        throw new PermanentEventError('poison');
      },
      { deadLetter: { topic: 'not a valid topic name!' } },
    );
    await t.publish(sampleEvent(randomUUID()));
    await waitFor(() => calls >= 2 * fast.permanentAttempts, {
      timeoutMs: 90_000,
      description: 'redelivered after the failed dead-letter write',
    });
    expect(consumer.crashed).toBe(false);
    expect(
      t.lines.some(
        (l) => l['msg'] === 'dead-letter write failed; message left unacknowledged for redelivery',
      ),
    ).toBe(true);
    await consumer.stop();
  });

  it('stopping during retries hands the event back unacknowledged (restart processes it)', async () => {
    const t = await setup();
    const event = sampleEvent(randomUUID());
    const groupId = `dlq-test-${randomUUID()}`;
    let failing = 0;
    const first = await t.start(
      async () => {
        failing++;
        throw Object.assign(new Error('Connection is closed.'), {});
      },
      { retry: { ...fast, transientAttempts: 1000, baseMs: 200, maxMs: 200 } },
      groupId,
    );
    await t.publish(event);
    await waitFor(() => failing >= 2, { description: 'retrying' });
    await first.stop();

    const done: string[] = [];
    const second = await t.start(async (e) => void done.push(e.eventId), {}, groupId);
    await waitFor(() => done.includes(event.eventId), {
      timeoutMs: 60_000,
      description: 'processed after restart',
    });
    await second.stop();
    expect(await readDeadLetters(t.kafka, { topic: t.dlqTopic })).toEqual([]);
  });

  it('replay republishes the original event (same eventId, correlationId, key) and marks it as a replay', async () => {
    const t = await setup();
    const projectId = randomUUID();
    const poison = sampleEvent(projectId, { correlationId: 'corr-replay-1' });
    let broken = true;
    const seen: {
      eventId: string;
      correlationId: string;
      key: string | null;
      replayed: string | undefined;
    }[] = [];
    const consumer = await t.start(async (e, m) => {
      if (broken && e.eventId === poison.eventId) throw new PermanentEventError('poison');
      seen.push({
        eventId: e.eventId,
        correlationId: e.correlationId,
        key: m.key,
        replayed: m.headers['x-replayed-from-dlq'],
      });
    });
    await t.publish(poison);
    const letters = await waitFor(
      async () => {
        const l = await readDeadLetters(t.kafka, { topic: t.dlqTopic });
        return l.length > 0 ? l : undefined;
      },
      { timeoutMs: 30_000, description: 'dead-lettered' },
    );
    broken = false; // "the bug is fixed"
    const result = await replayDeadLetters(t.kafka, letters, {
      logger: t.logger,
      operator: 'test',
      targetTopic: t.topic,
    });
    expect(result.replayed).toHaveLength(1);
    await waitFor(() => seen.length === 1, {
      timeoutMs: 30_000,
      description: 'replayed event consumed',
    });
    await consumer.stop();
    expect(seen[0]).toEqual({
      eventId: poison.eventId,
      correlationId: 'corr-replay-1',
      key: projectId,
      replayed: `${letters[0]!.partition}/${letters[0]!.offset}`,
    });
    expect(
      t.lines.some((l) => l['msg'] === 'dead-lettered event replayed' && l['operator'] === 'test'),
    ).toBe(true);
  });

  it('replay refuses malformed records (nothing valid to send)', async () => {
    const t = await setup();
    const result = await replayDeadLetters(
      t.kafka,
      [
        {
          partition: 0,
          offset: '0',
          record: {
            dlqVersion: 1,
            category: 'malformed',
            consumer: 'x',
            error: 'invalid_json',
            attempts: 1,
            failedAt: new Date().toISOString(),
            source: { topic: t.topic, partition: 0, offset: '0', key: null },
            rawBase64: '',
          },
        },
      ],
      { logger: t.logger, operator: 'test', targetTopic: t.topic },
    );
    expect(result.replayed).toEqual([]);
    expect(result.skipped[0]!.reason).toMatch(/malformed/);
  });
});
