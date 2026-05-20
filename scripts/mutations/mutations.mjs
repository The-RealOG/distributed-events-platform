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

// Phase 5 (idempotent consumption)
const IDEM = 'packages/database/src/idempotency.ts';
const SYS = { cwd: 'tests', config: 'vitest.config.ts' };
const IDEM_TESTS = [{ ...SYS, files: ['integration/idempotent-consumer.int.test.ts'] }];
const BT = '`';
const MARKER_INSERT = [
  `INSERT INTO processed_events (consumer_name, event_id, event_type)`,
  '      VALUES (${consumerName}, ${input.event.eventId}, ${input.event.eventType})',
  '      ON CONFLICT (consumer_name, event_id) DO NOTHING',
].join('\n');
const MARKER_EXISTS =
  'SELECT 1 FROM processed_events WHERE consumer_name = ${consumerName} AND event_id = ${input.event.eventId}';
const CLAIM_BLOCK = [
  '  return db.transaction(async (tx) => {',
  `    const claimed = await tx.execute(sql${BT}`,
  `      ${MARKER_INSERT}`,
  '      RETURNING 1',
  `    ${BT});`,
  "    if (claimed.rows.length === 0) return 'duplicate';",
  '    await work(tx);',
  "    return 'processed';",
  '  });',
].join('\n');

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
  {
    id: 'p5-baseline',
    phase: 5,
    title: 'no mutation: the idempotent-consumer suite passes',
    edits: [],
    tests: IDEM_TESTS,
    expect: 'pass',
  },
  {
    id: 'p5-01-unique-constraint-removed',
    phase: 5,
    title: 'processed_events without its (consumer_name, event_id) key',
    edits: [
      {
        file: 'packages/database/migrations/0002_processed_events.sql',
        find: '\tCONSTRAINT "processed_events_pkey" PRIMARY KEY("consumer_name","event_id"),\n',
        replace: '',
      },
    ],
    tests: IDEM_TESTS,
  },
  {
    id: 'p5-02-random-instance-identity',
    phase: 5,
    title: 'each handler instance (replica/process) gets its own random consumer identity',
    edits: [
      {
        file: IDEM,
        find: 'const consumerName = assertConsumerName(options.consumerName);',
        replace:
          'const consumerName = assertConsumerName(`${options.consumerName}-${crypto.randomUUID().slice(0, 8)}`);',
      },
    ],
    tests: IDEM_TESTS,
  },
  {
    id: 'p5-03-marker-committed-before-side-effect',
    phase: 5,
    title: 'marker inserted and committed on its own, then the side effect in a later transaction',
    edits: [
      {
        file: IDEM,
        find: CLAIM_BLOCK,
        replace: [
          `  const claimed = await db.execute(sql${BT}${MARKER_INSERT} RETURNING 1${BT});`,
          "  if (claimed.rows.length === 0) return 'duplicate';",
          "  return db.transaction(async (tx) => { await work(tx); return 'processed' as const; });",
        ].join('\n'),
      },
    ],
    tests: IDEM_TESTS,
  },
  {
    id: 'p5-04-marker-outside-side-effect-transaction',
    phase: 5,
    title: 'check marker, commit the side effect, then insert the marker separately',
    edits: [
      {
        file: IDEM,
        find: CLAIM_BLOCK,
        replace: [
          `  const done = await db.execute(sql${BT}${MARKER_EXISTS}${BT});`,
          "  if (done.rows.length > 0) return 'duplicate';",
          '  await db.transaction(async (tx) => { await work(tx); });',
          `  await db.execute(sql${BT}${MARKER_INSERT}${BT});`,
          "  return 'processed';",
        ].join('\n'),
      },
    ],
    tests: IDEM_TESTS,
  },
  {
    id: 'p5-05-offset-committed-before-processing',
    phase: 5,
    title: 'consumer commits the Kafka offset before the handler (and its DB transaction) runs',
    edits: [
      {
        file: 'packages/kafka/src/consumer.ts',
        find: '    const started = performance.now();\n    try {\n      await this.#options.handler(event, metadata);',
        replace:
          '    await this.#consumer.commitOffsets([{ topic, partition, offset: (BigInt(message.offset) + 1n).toString() }]);\n    const started = performance.now();\n    try {\n      await this.#options.handler(event, metadata);',
      },
    ],
    tests: IDEM_TESTS,
  },
  {
    id: 'p5-06-check-then-act-race',
    phase: 5,
    title: 'SELECT marker, run side effect, INSERT marker ON CONFLICT DO NOTHING (race ignored)',
    edits: [
      {
        file: IDEM,
        find: CLAIM_BLOCK,
        replace: [
          '  return db.transaction(async (tx) => {',
          `    const done = await tx.execute(sql${BT}${MARKER_EXISTS}${BT});`,
          "    if (done.rows.length > 0) return 'duplicate';",
          '    await work(tx);',
          `    await tx.execute(sql${BT}${MARKER_INSERT}${BT});`,
          "    return 'processed';",
          '  });',
        ].join('\n'),
      },
    ],
    tests: IDEM_TESTS,
  },
  {
    id: 'p5-07-global-dedupe-across-consumers',
    phase: 5,
    title: 'an event processed by any consumer counts as processed for all',
    edits: [
      {
        file: IDEM,
        find: '      VALUES (${consumerName}, ${input.event.eventId}, ${input.event.eventType})',
        replace:
          '      SELECT ${consumerName}, ${input.event.eventId}::uuid, ${input.event.eventType}\n      WHERE NOT EXISTS (SELECT 1 FROM processed_events WHERE event_id = ${input.event.eventId}::uuid)',
      },
    ],
    tests: IDEM_TESTS,
  },
  {
    id: 'p5-08-marker-kept-after-handler-failure',
    phase: 5,
    title: 'handler errors are swallowed, so the marker commits although the work failed',
    edits: [
      {
        file: IDEM,
        find: "    await work(tx);\n    return 'processed';",
        replace: "    await work(tx).catch(() => undefined);\n    return 'processed';",
      },
    ],
    tests: IDEM_TESTS,
  },
  {
    id: 'p5-09-checked-out-client-error-unhandled',
    phase: 5,
    title:
      'no error listener on checked-out clients: a connection dying mid-transaction crashes the process',
    edits: [
      {
        file: 'packages/database/src/client.ts',
        find: "    client.on('error', () => {});\n",
        replace: '    void client;\n',
      },
    ],
    tests: IDEM_TESTS,
  },
];
