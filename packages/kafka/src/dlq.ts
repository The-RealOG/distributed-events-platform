import { domainEventSchema, partitionKeyOf } from '@dpp/contracts';
import type { Kafka } from 'kafkajs';
import type { Logger } from 'pino';
import { encodeDomainEvent } from './encoding.js';
import { DLQ_RECORD_VERSION, type DlqRecord } from './failures.js';
import { TOPICS } from './topics.js';

export interface DeadLetter {
  partition: number;
  offset: string;
  record: DlqRecord;
}

/**
 * Reads every record currently in the DLQ (from the beginning up to the high watermark at the
 * time of the call). Read-only: uses a throwaway consumer group and commits nothing.
 */
export async function readDeadLetters(
  kafka: Kafka,
  options: { topic?: string; timeoutMs?: number } = {},
): Promise<DeadLetter[]> {
  const topic = options.topic ?? TOPICS.domainEventsDlq.name;
  const admin = kafka.admin();
  await admin.connect();
  const ends = await admin.fetchTopicOffsets(topic);
  await admin.disconnect();
  const remaining = new Map(
    ends.filter((p) => BigInt(p.high) > BigInt(p.low)).map((p) => [p.partition, BigInt(p.high)]),
  );
  const out: DeadLetter[] = [];
  if (remaining.size === 0) return out;

  const consumer = kafka.consumer({
    groupId: `dlq-reader-${crypto.randomUUID()}`,
    maxWaitTimeInMs: 500,
  });
  await consumer.connect();
  await consumer.subscribe({ topic, fromBeginning: true });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('timed out reading the DLQ')),
      options.timeoutMs ?? 30_000,
    );
    void consumer
      .run({
        autoCommit: false,
        eachMessage: async ({ partition, message }) => {
          try {
            const record = JSON.parse(message.value?.toString() ?? '') as DlqRecord;
            if (record.dlqVersion === DLQ_RECORD_VERSION) {
              out.push({ partition, offset: message.offset, record });
            }
          } catch {
            // Not a DLQ record we understand: skip it (it stays in the topic).
          }
          const end = remaining.get(partition);
          if (end !== undefined && BigInt(message.offset) + 1n >= end) remaining.delete(partition);
          if (remaining.size === 0) {
            clearTimeout(timer);
            resolve();
          }
        },
      })
      .catch(reject);
  });
  await consumer.disconnect();
  return out;
}

export interface ReplayResult {
  replayed: DeadLetter[];
  skipped: { letter: DeadLetter; reason: string }[];
}

/**
 * Republishes dead-lettered events to the domain topic, intentionally and once per call.
 * The event is sent byte-for-byte as it was (same eventId, correlationId, key), so idempotent
 * consumers treat a replay of something they already applied as a duplicate. Malformed records
 * cannot be replayed (there is no valid event to send). Every replay is logged.
 */
export async function replayDeadLetters(
  kafka: Kafka,
  letters: DeadLetter[],
  options: { logger: Logger; operator: string; targetTopic?: string },
): Promise<ReplayResult> {
  const result: ReplayResult = { replayed: [], skipped: [] };
  const producer = kafka.producer({ allowAutoTopicCreation: false, maxInFlightRequests: 1 });
  await producer.connect();
  try {
    for (const letter of letters) {
      if (letter.record.category !== 'poison' || !letter.record.event) {
        result.skipped.push({ letter, reason: 'malformed record: nothing valid to replay' });
        continue;
      }
      const parsed = domainEventSchema.safeParse(letter.record.event);
      if (!parsed.success) {
        result.skipped.push({ letter, reason: 'stored event no longer validates' });
        continue;
      }
      const message = encodeDomainEvent(parsed.data);
      await producer.send({
        topic: options.targetTopic ?? TOPICS.domainEvents.name,
        acks: -1,
        messages: [
          {
            ...message,
            key: partitionKeyOf(parsed.data),
            headers: {
              ...message.headers,
              'x-replayed-from-dlq': `${letter.partition}/${letter.offset}`,
              'x-replayed-by': options.operator,
            },
          },
        ],
      });
      options.logger.warn(
        {
          eventId: parsed.data.eventId,
          eventType: parsed.data.eventType,
          correlationId: parsed.data.correlationId,
          failedConsumer: letter.record.consumer,
          dlqPartition: letter.partition,
          dlqOffset: letter.offset,
          operator: options.operator,
        },
        'dead-lettered event replayed',
      );
      result.replayed.push(letter);
    }
  } finally {
    await producer.disconnect();
  }
  return result;
}
