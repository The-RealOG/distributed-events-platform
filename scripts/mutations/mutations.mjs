/**
 * Deliberate breaks ("mutations") of the delivery guarantees. Each one must make the listed
 * real-infrastructure tests FAIL; `baseline` (no edit) must make them pass. Run in CI by
 * .github/workflows/mutations.yml, one job per entry; locally: node scripts/mutations/run.mjs <id>
 * (needs Docker for Testcontainers).
 *
 * Every edit must match its file exactly once, so an entry that no longer fits the code fails
 * loudly instead of silently testing nothing.
 */
const PS = { cwd: 'apps/project-service', config: 'vitest.integration.config.ts' };
const PUB = { cwd: 'apps/outbox-publisher', config: 'vitest.integration.config.ts' };
const SERVICE = 'apps/project-service/src/modules/tasks/service.ts';
const OUTBOX = 'packages/database/src/outbox.ts';
const PUBLISHER = 'apps/outbox-publisher/src/publisher.ts';
const PUBLISH_CALL =
  'published = await this.#o.sink.publish(row.event, { key: row.partitionKey });';
const LEASE_CHECK = 'AND (c.claimed_until IS NULL OR c.claimed_until < now())';

export const mutations = [
  {
    id: 'p4-baseline',
    phase: 4,
    title: 'no mutation: the targeted suites pass',
    edits: [],
    tests: [
      { ...PS, files: ['test/outbox.int.test.ts'] },
      { ...PUB, files: [] },
    ],
    expect: 'pass',
  },
  {
    id: 'p4-01-outbox-outside-transaction',
    phase: 4,
    title: 'task.created outbox insert uses the pool instead of the transaction handle',
    edits: [
      {
        file: SERVICE,
        find: 'await insertOutboxEvent(tx, buildTaskEvent.created(ctx, task));',
        replace: 'await insertOutboxEvent(this.db as never, buildTaskEvent.created(ctx, task));',
      },
    ],
    tests: [{ ...PS, files: ['test/outbox.int.test.ts'], name: 'Invariant 1 \\+ 2' }],
  },
  {
    id: 'p4-02-event-id-regenerated',
    phase: 4,
    title: 'publisher sends a fresh eventId on each attempt',
    edits: [
      {
        file: PUBLISHER,
        find: PUBLISH_CALL,
        replace:
          'published = await this.#o.sink.publish({ ...row.event, eventId: crypto.randomUUID() }, { key: row.partitionKey });',
      },
    ],
    tests: [
      { ...PUB, files: ['test/publisher.int.test.ts', 'test/crash-and-shutdown.int.test.ts'] },
    ],
  },
  {
    id: 'p4-03-published-before-ack',
    phase: 4,
    title: 'published_at written before the Kafka send',
    edits: [
      {
        file: PUBLISHER,
        find: '      await this.#o.faults?.beforePublish?.(row);',
        replace:
          '      await markOutboxPublished(this.#o.db, row.sequenceId);\n      await this.#o.faults?.beforePublish?.(row);',
      },
    ],
    tests: [{ ...PUB, files: [] }],
  },
  {
    id: 'p4-04a-claim-protection-removed',
    phase: 4,
    title: 'claim ignores live leases and row locks',
    edits: [
      { file: OUTBOX, find: `        ${LEASE_CHECK}\n`, replace: '' },
      { file: OUTBOX, find: '      FOR UPDATE SKIP LOCKED\n', replace: '' },
    ],
    tests: [{ ...PUB, files: ['test/publisher.int.test.ts'] }],
  },
  {
    id: 'p4-04b-skip-locked-removed',
    phase: 4,
    title: 'claim keeps the lease check but takes no row locks (concurrent claimers race)',
    edits: [{ file: OUTBOX, find: '      FOR UPDATE SKIP LOCKED\n', replace: '' }],
    tests: [{ ...PUB, files: ['test/publisher.int.test.ts'], name: 'Invariant 6' }],
  },
  {
    id: 'p4-05a-wrong-partition-key-stored',
    phase: 4,
    title: 'outbox row stores the task id as partition key',
    edits: [
      {
        file: OUTBOX,
        find: 'partitionKey: partitionKeyOf(event),',
        replace: 'partitionKey: event.aggregateId,',
      },
    ],
    tests: [{ ...PS, files: ['test/outbox.int.test.ts'] }],
  },
  {
    id: 'p4-05b-partition-key-rederived',
    phase: 4,
    title: 'publisher derives the key again instead of using the stored one',
    edits: [
      {
        file: PUBLISHER,
        find: PUBLISH_CALL,
        replace:
          'published = await this.#o.sink.publish(row.event, { key: row.event.aggregateId });',
      },
    ],
    tests: [{ ...PUB, files: ['test/publisher.int.test.ts'] }],
  },
  {
    id: 'p4-06a-correlation-replaced-at-write',
    phase: 4,
    title: 'events get a new correlation ID instead of the request’s',
    edits: [
      {
        file: 'apps/project-service/src/modules/tasks/events.ts',
        find: 'correlationId: ctx.correlationId,',
        replace: 'correlationId: crypto.randomUUID(),',
      },
    ],
    tests: [{ ...PS, files: ['test/outbox.int.test.ts'] }],
  },
  {
    id: 'p4-06b-correlation-replaced-at-publish',
    phase: 4,
    title: 'publisher replaces the stored correlation ID',
    edits: [
      {
        file: PUBLISHER,
        find: PUBLISH_CALL,
        replace:
          'published = await this.#o.sink.publish({ ...row.event, correlationId: crypto.randomUUID() }, { key: row.partitionKey });',
      },
    ],
    tests: [{ ...PUB, files: ['test/publisher.int.test.ts'] }],
  },
  {
    id: 'p4-07-pre-mutation-version',
    phase: 4,
    title: 'task.updated carries the client’s expectedVersion instead of the new version',
    edits: [
      {
        file: SERVICE,
        find: 'buildTaskEvent.updated(ctx, task, updated)',
        replace:
          'buildTaskEvent.updated(ctx, task, { ...updated, version: input.expectedVersion })',
      },
    ],
    tests: [{ ...PS, files: ['test/outbox.int.test.ts'] }],
  },
  {
    id: 'p4-08-http-depends-on-kafka',
    phase: 4,
    title: 'task creation connects to a Kafka broker inside the request',
    edits: [
      {
        file: SERVICE,
        find: 'await insertOutboxEvent(tx, buildTaskEvent.created(ctx, task));',
        replace: `await insertOutboxEvent(tx, buildTaskEvent.created(ctx, task));
      {
        const { Kafka } = await import('kafkajs');
        const producer = new Kafka({
          brokers: [process.env['KAFKA_BROKERS'] ?? 'localhost:9092'],
          retry: { retries: 2 },
        }).producer();
        await producer.connect();
        await producer.disconnect();
      }`,
      },
    ],
    tests: [{ ...PS, files: ['test/outbox.int.test.ts'], name: 'Invariant 3' }],
  },
  {
    id: 'p4-09-retry-backoff-disabled',
    phase: 4,
    title: 'a failed row is eligible again immediately',
    edits: [
      {
        file: OUTBOX,
        find: 'next_attempt_at = now() + make_interval(secs => ${options.retryAfterMs / 1000}),',
        replace: 'next_attempt_at = now(),',
      },
    ],
    tests: [{ ...PUB, files: ['test/publisher.int.test.ts', 'test/kafka-outage.int.test.ts'] }],
  },
  {
    id: 'p4-10-stale-claim-recovery-broken',
    phase: 4,
    title: 'an expired lease is never reclaimed',
    edits: [{ file: OUTBOX, find: LEASE_CHECK, replace: 'AND c.claimed_until IS NULL' }],
    tests: [
      { ...PUB, files: ['test/publisher.int.test.ts', 'test/crash-and-shutdown.int.test.ts'] },
    ],
  },
];
