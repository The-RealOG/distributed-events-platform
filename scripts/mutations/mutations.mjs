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

// Idempotent consumption
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

// Activity projection and shared board cache
const ACT = { cwd: 'apps/activity-service', config: 'vitest.integration.config.ts' };
const ACT_TESTS = [{ ...ACT, files: [] }];
const PS_ACTIVITY = [{ ...PS, files: ['test/activity.int.test.ts'] }];
const SYSTEM_P67 = { ...SYS, files: ['integration/projections-and-cache.int.test.ts'] };
const CACHE_INT = { cwd: 'packages/cache', config: 'vitest.integration.config.ts', files: [] };
const CACHE_UNIT = { cwd: 'packages/cache', config: 'vitest.config.ts', files: [] };
const INV_UNIT = { cwd: 'apps/cache-invalidator', config: 'vitest.config.ts', files: [] };
const ARCH = { cwd: 'tests', config: 'vitest.unit.config.ts', files: ['architecture'] };
const ACT_WORKER = 'apps/activity-service/src/worker.ts';
const ACT_HANDLER = [
  '    handler: createIdempotentHandler({',
  '      db: options.db,',
  '      consumerName: CONSUMER_NAME,',
  '      logger: options.logger,',
  '      handle: (event, tx) => recordActivity(tx, event),',
  '      onOutcome: count,',
  '    }),',
].join('\n');
const DIRECT_HANDLER = [
  '    handler: async (event) => {',
  '      await options.db.transaction((tx) => recordActivity(tx, event));',
  "      count('processed');",
  '    },',
].join('\n');
const PROJECTION = 'apps/activity-service/src/projection.ts';
const BOARD_SERVICE = 'apps/project-service/src/modules/projects/service.ts';
const SHARED = 'packages/cache/src/shared-cache.ts';
const INV_WORKER = 'apps/cache-invalidator/src/worker.ts';
const TASK_SERVICE = 'apps/project-service/src/modules/tasks/service.ts';

// Realtime; consumer retries and the DLQ
const RT_APP = 'apps/realtime-service/src/app.ts';
const RT_HUB = 'apps/realtime-service/src/hub.ts';
const RT_WORKER = 'apps/realtime-service/src/worker.ts';
const RT_INT = { cwd: 'apps/realtime-service', config: 'vitest.integration.config.ts', files: [] };
const RT_UNIT = { cwd: 'apps/realtime-service', config: 'vitest.config.ts', files: [] };
const WEB_RT = { cwd: 'apps/web', config: 'vite.config.ts', files: ['src/lib/realtime'] };
const SYSTEM_RT = { ...SYS, files: ['integration/realtime-chain.int.test.ts'] };
const WEB_CONN = 'apps/web/src/lib/realtime/connection.ts';
const CONSUMER = 'packages/kafka/src/consumer.ts';
const FAILURES = 'packages/kafka/src/failures.ts';
const DLQ_INT = {
  cwd: 'packages/kafka',
  config: 'vitest.integration.config.ts',
  files: ['test/dlq.int.test.ts'],
};
const KAFKA_UNIT = {
  cwd: 'packages/kafka',
  config: 'vitest.config.ts',
  files: ['src/failures.test.ts'],
};

// Attachments
const ATT_SERVICE = 'apps/project-service/src/modules/attachments/service.ts';
const STORAGE = 'packages/storage/src/object-storage.ts';
const ATT_INT = { ...PS, files: ['test/attachments.int.test.ts'] };
const STORAGE_INT = { cwd: 'packages/storage', config: 'vitest.integration.config.ts', files: [] };
const STORAGE_UNIT = { cwd: 'packages/storage', config: 'vitest.config.ts', files: [] };
const DB_ERRORS = 'packages/database/src/errors.ts';
const PS_CONFIG = 'apps/project-service/src/config.ts';
const PS_UNIT = {
  cwd: 'apps/project-service',
  config: 'vitest.config.ts',
  files: ['src/config.test.ts'],
};
const PS_ERRORS = 'apps/project-service/src/http/errors.ts';
const PS_ERRORS_UNIT = {
  cwd: 'apps/project-service',
  config: 'vitest.config.ts',
  files: ['src/http/errors.test.ts'],
};
const PS_IDEMPOTENCY = 'apps/project-service/src/http/idempotency.ts';
const GATEWAY_APP = 'apps/api-gateway/src/app.ts';
const GATEWAY_UNIT = {
  cwd: 'apps/api-gateway',
  config: 'vitest.config.ts',
  files: ['test/gateway.test.ts'],
};
const DB_UNIT = {
  cwd: 'packages/database',
  config: 'vitest.config.ts',
  files: ['src/errors.test.ts'],
};

export const mutations = [
  {
    id: 'outbox-baseline',
    group: 'outbox',
    title: 'no mutation: the targeted suites pass',
    edits: [],
    tests: [
      { ...PS, files: ['test/outbox.int.test.ts'] },
      { ...PUB, files: [] },
    ],
    expect: 'pass',
  },
  {
    id: 'outbox-01-outbox-outside-transaction',
    group: 'outbox',
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
    id: 'outbox-02-event-id-regenerated',
    group: 'outbox',
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
    id: 'outbox-03-published-before-ack',
    group: 'outbox',
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
    id: 'outbox-04a-claim-protection-removed',
    group: 'outbox',
    title: 'claim ignores live leases and row locks',
    edits: [
      { file: OUTBOX, find: `        ${LEASE_CHECK}\n`, replace: '' },
      { file: OUTBOX, find: '      FOR UPDATE SKIP LOCKED\n', replace: '' },
    ],
    tests: [{ ...PUB, files: ['test/publisher.int.test.ts'] }],
  },
  {
    id: 'outbox-04b-skip-locked-removed',
    group: 'outbox',
    title: 'claim keeps the lease check but takes no row locks (concurrent claimers race)',
    edits: [{ file: OUTBOX, find: '      FOR UPDATE SKIP LOCKED\n', replace: '' }],
    tests: [{ ...PUB, files: ['test/publisher.int.test.ts'], name: 'Invariant 6' }],
  },
  {
    id: 'outbox-05a-wrong-partition-key-stored',
    group: 'outbox',
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
    id: 'outbox-05b-partition-key-rederived',
    group: 'outbox',
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
    id: 'outbox-06a-correlation-replaced-at-write',
    group: 'outbox',
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
    id: 'outbox-06b-correlation-replaced-at-publish',
    group: 'outbox',
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
    id: 'outbox-07-pre-mutation-version',
    group: 'outbox',
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
    id: 'outbox-08-http-depends-on-kafka',
    group: 'outbox',
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
    id: 'outbox-09-retry-backoff-disabled',
    group: 'outbox',
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
    id: 'outbox-10-stale-claim-recovery-broken',
    group: 'outbox',
    title: 'an expired lease is never reclaimed',
    edits: [{ file: OUTBOX, find: LEASE_CHECK, replace: 'AND c.claimed_until IS NULL' }],
    tests: [
      { ...PUB, files: ['test/publisher.int.test.ts', 'test/crash-and-shutdown.int.test.ts'] },
    ],
  },
  {
    id: 'consumers-baseline',
    group: 'consumers',
    title: 'no mutation: the idempotent-consumer suite passes',
    edits: [],
    tests: IDEM_TESTS,
    expect: 'pass',
  },
  {
    id: 'consumers-01-unique-constraint-removed',
    group: 'consumers',
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
    id: 'consumers-02-random-instance-identity',
    group: 'consumers',
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
    id: 'consumers-03-marker-committed-before-side-effect',
    group: 'consumers',
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
    id: 'consumers-04-marker-outside-side-effect-transaction',
    group: 'consumers',
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
    // Not awaiting the handler lets KafkaJS resolve (and auto-commit) the offset before the
    // handler's DB transaction commits or fails. A first version, a manual commitOffsets before
    // the handler, was masked by KafkaJS re-committing its own resolved offset and survived.
    id: 'consumers-05-offset-committed-before-processing',
    group: 'consumers',
    title: 'consumer acknowledges the message before the handler’s DB transaction finishes',
    edits: [
      {
        file: 'packages/kafka/src/consumer.ts',
        find: '      await this.#options.handler(event, metadata);',
        replace: '      void this.#options.handler(event, metadata).catch(() => undefined);',
      },
    ],
    tests: IDEM_TESTS,
  },
  {
    id: 'consumers-06-check-then-act-race',
    group: 'consumers',
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
    id: 'consumers-07-global-dedupe-across-consumers',
    group: 'consumers',
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
    id: 'consumers-08-marker-kept-after-handler-failure',
    group: 'consumers',
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
    id: 'consumers-09-checked-out-client-error-unhandled',
    group: 'consumers',
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
  // ---------------------------------------------------------------- activity
  {
    id: 'activity-baseline',
    group: 'activity',
    title: 'no mutation: activity suites pass',
    edits: [],
    tests: [...ACT_TESTS, ...PS_ACTIVITY],
    expect: 'pass',
  },
  {
    id: 'activity-01-bypasses-consumer-dedupe',
    group: 'activity',
    title: 'activity worker writes directly, without processEventOnce',
    edits: [{ file: ACT_WORKER, find: ACT_HANDLER, replace: DIRECT_HANDLER }],
    tests: ACT_TESTS,
  },
  {
    id: 'activity-02-duplicate-creates-duplicate-activity',
    group: 'activity',
    title: 'no dedupe and no UNIQUE(event_id): a redelivery adds a second entry',
    edits: [
      { file: ACT_WORKER, find: ACT_HANDLER, replace: DIRECT_HANDLER },
      {
        file: 'packages/database/migrations/0003_activity_events.sql',
        find: ',\n\tCONSTRAINT "activity_events_event_id_unique" UNIQUE("event_id")',
        replace: '',
      },
    ],
    tests: ACT_TESTS,
  },
  {
    id: 'activity-03-marker-commits-activity-rolls-back',
    group: 'activity',
    title: 'activity insert failure swallowed (savepoint): the marker commits without the entry',
    edits: [
      {
        file: PROJECTION,
        find: '  await tx.insert(activityEvents).values(toActivityRow(event));',
        replace:
          '  await tx.transaction((sp) => sp.insert(activityEvents).values(toActivityRow(event))).catch(() => undefined);',
      },
    ],
    tests: ACT_TESTS,
  },
  {
    id: 'activity-04-activity-commits-marker-does-not',
    group: 'activity',
    title: 'activity written in its own transaction, separate from the processed marker',
    edits: [
      {
        file: ACT_WORKER,
        find: '      handle: (event, tx) => recordActivity(tx, event),',
        replace:
          '      handle: (event) => options.db.transaction((own) => recordActivity(own, event)),',
      },
    ],
    tests: ACT_TESTS,
  },
  {
    id: 'activity-05-offset-before-db-transaction',
    group: 'activity',
    title: 'consumer acknowledges before the activity transaction finishes',
    edits: [
      {
        file: 'packages/kafka/src/consumer.ts',
        find: '      await this.#options.handler(event, metadata);',
        replace: '      void this.#options.handler(event, metadata).catch(() => undefined);',
      },
    ],
    tests: ACT_TESTS,
  },
  {
    id: 'activity-06-activity-authorization-removed',
    group: 'activity',
    title: 'GET /projects/:id/activity without the project access check',
    edits: [
      {
        file: 'apps/project-service/src/modules/activity/service.ts',
        find: '    await requireProjectRole(this.db, principal.userId, projectId, REQUIRED_ROLE.readProject);\n',
        replace: '    void requireProjectRole;\n',
      },
    ],
    tests: PS_ACTIVITY,
  },
  {
    id: 'activity-07-wrong-project-id',
    group: 'activity',
    title: 'activity recorded under the task id instead of the project id',
    edits: [
      {
        file: PROJECTION,
        find: '    projectId: event.payload.projectId,',
        replace: '    projectId: event.aggregateId,',
      },
    ],
    tests: ACT_TESTS,
  },
  {
    id: 'activity-08-correlation-lost',
    group: 'activity',
    title: 'activity gets a fresh correlation ID',
    edits: [
      {
        file: PROJECTION,
        find: '    correlationId: event.correlationId,',
        replace: '    correlationId: crypto.randomUUID(),',
      },
    ],
    tests: ACT_TESTS,
  },
  {
    id: 'activity-09-request-path-writes-activity',
    group: 'activity',
    title: 'task creation writes activity synchronously in the request transaction',
    edits: [
      {
        file: TASK_SERVICE,
        find: "import { insertOutboxEvent, type Database, type DbExecutor } from '@dpp/database';",
        replace:
          "import { insertOutboxEvent, sql, type Database, type DbExecutor } from '@dpp/database';",
      },
      {
        file: TASK_SERVICE,
        find: '      await insertOutboxEvent(tx, buildTaskEvent.created(ctx, task));',
        replace: [
          '      await insertOutboxEvent(tx, buildTaskEvent.created(ctx, task));',
          "      await tx.execute(sql`INSERT INTO activity_events (event_id, project_id, event_type, aggregate_type, aggregate_id, aggregate_version, task_id, actor_id, data, correlation_id, occurred_at) VALUES (gen_random_uuid(), ${task.projectId}, 'task.created', 'task', ${task.id}, 1, ${task.id}, ${ctx.principal.userId}, '{}', ${ctx.correlationId}, now())`);",
        ].join('\n'),
      },
    ],
    tests: PS_ACTIVITY,
  },
  {
    id: 'activity-10-unstable-consumer-name',
    group: 'activity',
    title: 'each activity handler instance uses its own random consumer identity',
    edits: [
      {
        file: ACT_WORKER,
        find: '      consumerName: CONSUMER_NAME,',
        replace: '      consumerName: `${CONSUMER_NAME}-${crypto.randomUUID().slice(0, 8)}`,',
      },
    ],
    tests: [...ACT_TESTS, ARCH],
  },
  // ---------------------------------------------------------------- cache
  {
    id: 'cache-baseline',
    group: 'cache',
    title: 'no mutation: cache suites pass',
    edits: [],
    tests: [CACHE_UNIT, CACHE_INT, INV_UNIT, SYSTEM_P67],
    expect: 'pass',
  },
  {
    id: 'cache-01-wrong-cache-key',
    group: 'cache',
    title: 'board key without the project id (all projects share one entry)',
    edits: [
      {
        file: 'packages/cache/src/keys.ts',
        find: '    key: `board:v${BOARD_FORMAT}:${projectId}`,',
        replace: '    key: `board:v${BOARD_FORMAT}`,',
      },
    ],
    tests: [SYSTEM_P67],
  },
  {
    id: 'cache-02-update-not-invalidated',
    group: 'cache',
    title: 'task.updated does not invalidate the board',
    edits: [
      { file: INV_WORKER, find: "  'task.updated': true,", replace: "  'task.updated': false," },
    ],
    tests: [SYSTEM_P67],
  },
  {
    id: 'cache-03-invalidates-unrelated-projects',
    group: 'cache',
    title: 'invalidation deletes every board entry, not just the event’s project',
    edits: [
      {
        file: SHARED,
        find: "return redis.call('DEL', KEYS[1])`;",
        replace:
          "for _, k in ipairs(redis.call('KEYS', 'board:v*')) do redis.call('DEL', k) end\nreturn 1`;",
      },
    ],
    tests: [CACHE_INT, SYSTEM_P67],
  },
  {
    id: 'cache-04-redis-outage-500',
    group: 'cache',
    title: 'a cache read error fails the board request',
    edits: [
      {
        file: BOARD_SERVICE,
        find: "    if (cached.status === 'hit') return { board: cached.value, cache: 'HIT' };",
        replace:
          "    if (cached.status === 'error') throw new Error('cache unavailable');\n    if (cached.status === 'hit') return { board: cached.value, cache: 'HIT' };",
      },
    ],
    tests: [SYSTEM_P67],
  },
  {
    id: 'cache-05-set-failure-breaks-read',
    group: 'cache',
    title: 'a failed cache write throws into the request',
    edits: [
      {
        file: SHARED,
        find: "        'cache write failed; value not cached',\n      );\n",
        replace: "        'cache write failed; value not cached',\n      );\n      throw err;\n",
      },
    ],
    tests: [CACHE_INT],
  },
  {
    id: 'cache-06-writes-depend-on-redis',
    group: 'cache',
    title: 'task update invalidates Redis directly inside its transaction',
    edits: [
      {
        file: TASK_SERVICE,
        find: "import { insertOutboxEvent, type Database, type DbExecutor } from '@dpp/database';",
        replace: [
          "import { boardCacheEntry, createRedisClient, SharedCache } from '@dpp/cache';",
          "import { insertOutboxEvent, type Database, type DbExecutor } from '@dpp/database';",
          "import { pino } from 'pino';",
          "const quiet = pino({ level: 'silent' });",
          "const directCache = new SharedCache(createRedisClient({ url: process.env['REDIS_URL'] ?? 'redis://127.0.0.1:1', logger: quiet }), { logger: quiet, ttlSeconds: 1 });",
        ].join('\n'),
      },
      {
        file: TASK_SERVICE,
        find: '      await insertOutboxEvent(tx, buildTaskEvent.updated(ctx, task, updated));',
        replace:
          '      await insertOutboxEvent(tx, buildTaskEvent.updated(ctx, task, updated));\n      await directCache.invalidate(boardCacheEntry(task.projectId));',
      },
    ],
    tests: [ARCH, SYSTEM_P67],
  },
  {
    id: 'cache-07-authorization-bypass-on-hit',
    group: 'cache',
    title: 'the cached board is returned before the access check',
    edits: [
      {
        file: BOARD_SERVICE,
        find: '    const { project } = await requireProjectRole(\n      this.db,\n      principal.userId,\n      projectId,\n      REQUIRED_ROLE.readProject,\n    );\n    if (!this.boardCache)',
        replace:
          "    const early = options.fresh ? undefined : await this.boardCache?.read(projectId);\n    if (early?.status === 'hit') return { board: early.value, cache: 'HIT' };\n    const { project } = await requireProjectRole(\n      this.db,\n      principal.userId,\n      projectId,\n      REQUIRED_ROLE.readProject,\n    );\n    if (!this.boardCache)",
      },
    ],
    tests: [SYSTEM_P67],
  },
  {
    id: 'cache-08-invalidator-cannot-catch-up',
    group: 'cache',
    title: 'the invalidator acknowledges events whose invalidation failed',
    edits: [
      {
        file: INV_WORKER,
        find: "        'invalidation failed; will be redelivered',\n      );\n      throw err;",
        replace: "        'invalidation failed; will be redelivered',\n      );\n      return;",
      },
    ],
    tests: [SYSTEM_P67],
  },
  {
    id: 'cache-09-corrupt-entry-crashes',
    group: 'cache',
    title: 'a corrupt cache entry throws instead of being treated as a miss',
    edits: [
      {
        file: SHARED,
        find: '      this.stats.corrupt++;',
        replace:
          "      if (parsed.reason) throw new Error('corrupt cache entry');\n      this.stats.corrupt++;",
      },
    ],
    tests: [CACHE_INT],
  },
  {
    id: 'cache-10-no-ttl',
    group: 'cache',
    title: 'cached values are stored without expiry',
    edits: [
      {
        file: SHARED,
        find: "  redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])",
        replace: "  redis.call('SET', KEYS[1], ARGV[2])",
      },
    ],
    tests: [CACHE_INT],
  },
  {
    id: 'cache-11-stale-write-back',
    group: 'cache',
    title: 'write-back ignores the generation (a pre-invalidation snapshot is stored)',
    edits: [
      {
        file: SHARED,
        find: 'if current == ARGV[1] then',
        replace: 'if true then',
      },
    ],
    tests: [CACHE_INT],
  },
  {
    id: 'cache-12-no-read-your-writes',
    group: 'cache',
    title:
      'the board route ignores Cache-Control: no-cache (the writer may read its change back stale)',
    edits: [
      {
        file: 'apps/project-service/src/modules/projects/routes.ts',
        find: "      const fresh = /\\bno-cache\\b/.test(request.headers['cache-control'] ?? '');",
        replace:
          "      const fresh = false && /no-cache/.test(request.headers['cache-control'] ?? '');",
      },
    ],
    tests: [SYSTEM_P67],
  },
  // ---------------------------------------------------------------- realtime
  {
    id: 'realtime-baseline',
    group: 'realtime',
    title: 'no mutation: realtime, retry/DLQ and client reconnect suites pass',
    edits: [],
    tests: [RT_UNIT, RT_INT, WEB_RT, DLQ_INT, KAFKA_UNIT, SYSTEM_RT],
    expect: 'pass',
  },
  {
    id: 'realtime-01-subscribe-without-membership',
    group: 'realtime',
    title: 'subscriptions are accepted for projects the user is not a member of',
    edits: [
      {
        file: RT_APP,
        find: "if (access !== 'allowed') {",
        replace: "if ((access as string) === 'not_found') {",
      },
    ],
    tests: [RT_INT, SYSTEM_RT],
  },
  {
    id: 'realtime-02-unauthenticated-subscribe',
    group: 'realtime',
    title: 'a connection that skips auth is treated as authenticated',
    edits: [
      {
        file: RT_APP,
        find: "if (message.type !== 'auth') return reject('missing');",
        replace: "if (message.type !== 'auth') { client.userId = message.type; return; }",
      },
    ],
    tests: [RT_INT],
  },
  {
    id: 'realtime-03-no-auth-timeout',
    group: 'realtime',
    title: 'a connection that never authenticates is kept open forever',
    edits: [
      {
        file: RT_APP,
        find: "socket.close(REALTIME_CLOSE.authTimeout, 'authenticate first');",
        replace: 'void REALTIME_CLOSE.authTimeout;',
      },
    ],
    tests: [RT_INT],
  },
  {
    id: 'realtime-04-broadcast-to-every-room',
    group: 'realtime',
    title: 'events are sent to every connected client, not the project room',
    edits: [
      {
        file: RT_HUB,
        find: 'const room = this.#rooms.get(envelope.projectId);',
        replace: 'const room = new Set([...this.#clients].filter((c) => c.userId));',
      },
    ],
    tests: [RT_UNIT, RT_INT],
  },
  {
    id: 'realtime-05-duplicates-forwarded',
    group: 'realtime',
    title: 'a redelivered event is broadcast again (no duplicate suppression)',
    edits: [
      {
        file: RT_HUB,
        find: 'if (this.#recentSet.has(envelope.eventId)) {',
        replace: "if (this.#recentSet.has(envelope.eventId) && envelope.eventId === '') {",
      },
    ],
    tests: [RT_UNIT, RT_INT],
  },
  {
    id: 'realtime-06-unbounded-send-buffer',
    group: 'realtime',
    title: 'slow clients are never disconnected (server memory grows without bound)',
    edits: [
      {
        file: RT_HUB,
        find: 'if (client.socket.bufferedAmount > this.#options.maxBufferedBytes) {',
        replace: 'if (client.socket.bufferedAmount > Number.MAX_SAFE_INTEGER) {',
      },
    ],
    tests: [RT_UNIT, RT_INT],
  },
  {
    id: 'realtime-07-rooms-leak-on-disconnect',
    group: 'realtime',
    title: 'a disconnected client stays in its rooms',
    edits: [
      {
        file: RT_HUB,
        find: '      room?.delete(client);\n      if (room?.size === 0) this.#rooms.delete(projectId);\n    }',
        replace: '      void room;\n    }',
      },
    ],
    tests: [RT_UNIT, RT_INT],
  },
  {
    id: 'realtime-08-dead-peers-never-terminated',
    group: 'realtime',
    title: 'the heartbeat never terminates a peer that stopped answering pings',
    edits: [
      {
        file: RT_HUB,
        find: 'if (!client.alive) {',
        replace: 'if (!client.alive && !client.projects) {',
      },
    ],
    tests: [RT_UNIT, RT_INT],
  },
  {
    id: 'realtime-09-replicas-share-a-group',
    group: 'realtime',
    title: 'all replicas join one consumer group (each sees only some partitions)',
    edits: [
      {
        file: RT_WORKER,
        find: 'groupId: `${CONSUMER_NAME}.${options.instanceId}`,',
        replace: 'groupId: `${CONSUMER_NAME}.shared`,',
      },
    ],
    tests: [{ ...RT_INT, name: 'different replicas' }],
  },
  {
    id: 'realtime-10-kafka-metadata-leaks',
    group: 'realtime',
    title: 'notifications carry Kafka partition/offset to browsers',
    edits: [
      {
        file: RT_WORKER,
        find: 'const envelope = toRealtimeEnvelope(event);',
        replace:
          'const envelope = { ...toRealtimeEnvelope(event), partition: metadata.partition, offset: metadata.offset };',
      },
    ],
    tests: [RT_INT],
  },
  {
    id: 'realtime-11-shutdown-drops-clients',
    group: 'realtime',
    title: 'shutdown kills sockets instead of closing with "going away"',
    edits: [
      {
        file: RT_HUB,
        find: '      client.socket.close(code, reason);',
        replace: '      void code;\n      void reason;\n      client.socket.terminate();',
      },
    ],
    tests: [RT_INT],
  },
  {
    id: 'realtime-12-no-reconcile-after-reconnect',
    group: 'realtime',
    title: 'the browser does not refetch after (re)subscribing, so missed events stay missed',
    edits: [{ file: WEB_CONN, find: '        this.#o.onResync();\n', replace: '' }],
    tests: [WEB_RT],
  },
  {
    id: 'realtime-13-reconnect-without-jitter',
    group: 'realtime',
    title: 'every client reconnects after exactly the same delay (synchronized storm)',
    edits: [
      {
        file: WEB_CONN,
        find: 'return Math.round(ceiling / 2 + random() * (ceiling / 2));',
        replace: 'return Math.round(ceiling + 0 * random());',
      },
    ],
    tests: [WEB_RT],
  },
  {
    id: 'realtime-14-gateway-accepts-any-origin',
    group: 'realtime',
    title: 'the gateway relays WebSocket upgrades from any page origin',
    edits: [
      {
        file: 'apps/api-gateway/src/realtime-proxy.ts',
        find: 'if (origin && options.allowedOrigins.length > 0 && !options.allowedOrigins.includes(origin)) {',
        replace: 'if (origin && options.allowedOrigins.length > 0 && origin.length === 0) {',
      },
    ],
    tests: [{ ...SYSTEM_RT, name: 'another origin' }],
  },
  // ---------------------------------------------------------------- realtime: retries and the DLQ
  {
    id: 'realtime-d01-no-retry-before-dlq',
    group: 'realtime',
    title: 'a failing event is dead-lettered on the first attempt',
    edits: [
      {
        file: CONSUMER,
        find: "kind === 'permanent' ? this.#retry.permanentAttempts : this.#retry.transientAttempts;",
        replace: "kind === 'permanent' ? 1 : this.#retry.transientAttempts;",
      },
    ],
    tests: [DLQ_INT],
  },
  {
    id: 'realtime-d02-unbounded-poison-retries',
    group: 'realtime',
    title: 'a poison event is retried forever and blocks its partition',
    edits: [
      {
        file: CONSUMER,
        find: "kind === 'permanent' ? this.#retry.permanentAttempts : this.#retry.transientAttempts;",
        replace: "kind === 'permanent' ? Number.MAX_SAFE_INTEGER : this.#retry.transientAttempts;",
      },
    ],
    tests: [{ ...DLQ_INT, name: 'poison event is tried' }],
  },
  {
    id: 'realtime-d03-ack-despite-dlq-failure',
    group: 'realtime',
    title: 'the source offset is committed although the DLQ write failed (event lost)',
    edits: [
      {
        file: CONSUMER,
        find: '      throw new RedeliverError(`dead-letter write failed: ${sanitizeError(err)}`);',
        replace: '      return;',
      },
    ],
    tests: [{ ...DLQ_INT, name: 'DLQ cannot be written' }],
  },
  {
    id: 'realtime-d09-dlq-failure-crashes-consumer',
    group: 'realtime',
    title: 'a failed DLQ write is rethrown as-is (non-retriable errors stop the consumer for good)',
    edits: [
      {
        file: CONSUMER,
        find: '      throw new RedeliverError(`dead-letter write failed: ${sanitizeError(err)}`);',
        replace: '      void RedeliverError;\n      throw err;',
      },
    ],
    tests: [{ ...DLQ_INT, name: 'NON-retriable DLQ failure' }],
  },
  {
    id: 'realtime-d04-outage-classified-as-poison',
    group: 'realtime',
    title: 'dependency outages are classified permanent (the stream drains into the DLQ)',
    edits: [
      {
        file: FAILURES,
        find: "  if (TRANSIENT_CODES.has(code)) return 'transient';",
        replace: "  if (TRANSIENT_CODES.has(code)) return 'permanent';",
      },
    ],
    tests: [KAFKA_UNIT, DLQ_INT],
  },
  {
    id: 'realtime-d05-wrapped-driver-error',
    group: 'realtime',
    title:
      'classification ignores the wrapped driver error (the real SQLSTATE; leaks query params)',
    edits: [
      {
        file: FAILURES,
        find: '    if (cause === undefined || cause === null || cause === current) break;',
        replace: '    if (cause !== null || cause === current) break;',
      },
    ],
    tests: [KAFKA_UNIT],
  },
  {
    id: 'realtime-d06-dlq-error-unsanitized',
    group: 'realtime',
    title: 'DLQ records and logs keep credentials from error messages',
    edits: [
      {
        file: FAILURES,
        find: '  for (const [pattern, replacement] of REDACTIONS) text = text.replace(pattern, replacement);',
        replace: '  void REDACTIONS;',
      },
    ],
    tests: [KAFKA_UNIT, { ...DLQ_INT, name: 'poison event is tried' }],
  },
  {
    id: 'realtime-d07-malformed-silently-dropped',
    group: 'realtime',
    title: 'undecodable messages are skipped without a DLQ record',
    edits: [
      {
        file: CONSUMER,
        find: '      if (this.#dlqProducer) {\n        await this.#deadLetter(',
        replace:
          '      if (this.#dlqProducer && message.value === null) {\n        await this.#deadLetter(',
      },
    ],
    tests: [{ ...DLQ_INT, name: 'malformed input' }],
  },
  {
    id: 'realtime-d08-replay-changes-identity',
    group: 'realtime',
    title: 'replay republishes under a new eventId (idempotent consumers apply it twice)',
    edits: [
      {
        file: 'packages/kafka/src/dlq.ts',
        find: '      const message = encodeDomainEvent(parsed.data);',
        replace:
          '      const message = encodeDomainEvent({ ...parsed.data, eventId: crypto.randomUUID() });',
      },
    ],
    tests: [{ ...DLQ_INT, name: 'replay republishes' }],
  },
  // ---------------------------------------------------------------- attachments
  {
    id: 'attachments-baseline',
    group: 'attachments',
    title: 'no mutation: attachment and object-storage suites pass',
    edits: [],
    tests: [ATT_INT, STORAGE_INT, STORAGE_UNIT],
    expect: 'pass',
  },
  {
    id: 'attachments-01-download-without-authorization',
    group: 'attachments',
    title: 'attachments are served (and deleted) without checking the task access',
    edits: [
      {
        file: ATT_SERVICE,
        find: '    await requireTaskRole(this.db, principal.userId, row.taskId, role);\n    return row;',
        replace: '    void role;\n    return row;',
      },
    ],
    tests: [{ ...ATT_INT, name: 'authorization happens' }],
  },
  {
    id: 'attachments-02-any-content-type',
    group: 'attachments',
    title: 'the content-type allowlist is not enforced (text/html accepted)',
    edits: [
      {
        file: ATT_SERVICE,
        find: '    if (!isAllowedContentType(input.contentType)) {',
        replace: "    if (!isAllowedContentType(input.contentType) && input.contentType === '') {",
      },
    ],
    tests: [{ ...ATT_INT, name: 'enforces size and type' }],
  },
  {
    id: 'attachments-03-no-declared-size-limit',
    group: 'attachments',
    title: 'over-limit uploads are signed',
    edits: [
      {
        file: ATT_SERVICE,
        find: '    if (input.sizeBytes > this.limits.maxBytes) {',
        replace: '    if (input.sizeBytes > Number.MAX_SAFE_INTEGER) {',
      },
    ],
    tests: [{ ...ATT_INT, name: 'enforces size and type' }],
  },
  {
    id: 'attachments-04-signed-policy-without-size-bound',
    group: 'attachments',
    title: 'the presigned POST does not bind the body size',
    edits: [
      {
        file: STORAGE,
        find: "        ['content-length-range', 1, input.maxBytes],",
        replace: "        ['content-length-range', 1, input.maxBytes * 1_000_000],",
      },
    ],
    tests: [STORAGE_INT, { ...ATT_INT, name: 'enforces size and type' }],
  },
  {
    id: 'attachments-05-signed-policy-without-content-type',
    group: 'attachments',
    title: 'the presigned POST lets the browser choose the stored content type',
    edits: [
      {
        file: STORAGE,
        find: "        ['eq', '$Content-Type', input.contentType],",
        replace: "        ['starts-with', '$Content-Type', ''],",
      },
    ],
    tests: [STORAGE_UNIT, STORAGE_INT],
  },
  {
    id: 'attachments-06-user-controlled-object-key',
    group: 'attachments',
    title: 'the object key is built from the user-supplied file name',
    edits: [
      {
        file: ATT_SERVICE,
        find: '    const key = objectKey({ workspaceId, projectId: task.projectId, taskId, attachmentId: id });',
        replace:
          '    const key = `uploads/${input.filename}`;\n    void objectKey;\n    void workspaceId;',
      },
    ],
    tests: [{ ...ATT_INT, name: 'upload → finalize' }],
  },
  {
    id: 'attachments-07-finalize-trusts-browser',
    group: 'attachments',
    title: 'finalization marks ready without checking the stored object (HEAD)',
    edits: [
      {
        file: ATT_SERVICE,
        find: '      head = await this.storage.head(row.objectKey);',
        replace: '      head = { sizeBytes: row.sizeBytes, contentType: row.contentType };',
      },
    ],
    tests: [{ ...ATT_INT, name: 'never happened' }],
  },
  {
    id: 'attachments-08-oversized-object-accepted',
    group: 'attachments',
    title: 'a stored object larger than declared is accepted',
    edits: [
      {
        file: ATT_SERVICE,
        find: '    if (head.sizeBytes <= 0 || head.sizeBytes > Math.min(row.sizeBytes, this.limits.maxBytes)) {',
        replace: '    if (head.sizeBytes <= 0) {',
      },
    ],
    tests: [{ ...ATT_INT, name: 'larger than declared' }],
  },
  {
    id: 'attachments-09-sweep-forgets-failed-deletes',
    group: 'attachments',
    title: 'the sweep never retries object deletes that failed (orphans stay forever)',
    edits: [
      {
        file: ATT_SERVICE,
        find: "         OR (status = 'deleted' AND object_deleted_at IS NULL)",
        replace: '         OR false',
      },
    ],
    tests: [{ ...ATT_INT, name: 'sweep' }],
  },
  {
    id: 'attachments-10-storage-failure-is-500',
    group: 'attachments',
    title: 'a storage outage surfaces as an unhandled error instead of 503',
    edits: [
      {
        file: ATT_SERVICE,
        find: '      if (err instanceof StorageUnavailableError) throw storageDown();\n      throw err;',
        replace: '      void StorageUnavailableError;\n      throw err;',
      },
    ],
    tests: [{ ...ATT_INT, name: 'not connection failures' }],
  },
  {
    id: 'attachments-11-no-storage-timeouts',
    group: 'attachments',
    title: 'S3 calls have no timeout or retry bound (an outage hangs requests)',
    edits: [
      {
        file: STORAGE,
        find: '      maxAttempts: 2,\n      requestHandler: {\n        requestTimeout: options.requestTimeoutMs ?? 3_000,\n        connectionTimeout: 2_000,\n      },',
        replace:
          '      maxAttempts: 10,\n      retryMode: "adaptive",\n      requestHandler: {\n        requestTimeout: 120_000,\n        connectionTimeout: 60_000,\n      },',
      },
    ],
    tests: [STORAGE_INT, { ...ATT_INT, name: 'storage outage' }],
  },
  {
    id: 'attachments-12-download-rendered-inline',
    group: 'attachments',
    title: 'downloads are served inline (an uploaded file could render in the browser)',
    edits: [
      {
        file: STORAGE,
        find: '  return `attachment; filename="${ascii}"; filename*=UTF-8\'\'${encodeURIComponent(filename)}`;',
        replace:
          '  return `inline; filename="${ascii}"; filename*=UTF-8\'\'${encodeURIComponent(filename)}`;',
      },
    ],
    tests: [STORAGE_UNIT, { ...ATT_INT, name: 'upload → finalize' }],
  },
  {
    id: 'api-baseline',
    group: 'api',
    title: 'no mutation: database error classification passes',
    edits: [],
    tests: [
      DB_UNIT,
      PS_UNIT,
      PS_ERRORS_UNIT,
      { ...GATEWAY_UNIT, name: 'limits each user separately' },
    ],
    expect: 'pass',
  },
  {
    id: 'api-01-wrapped-pool-timeout-is-500',
    group: 'api',
    title: 'a pool timeout wrapped by Drizzle is answered 500 instead of 503 (found on AWS)',
    edits: [
      {
        file: DB_ERRORS,
        find: '  return errorChainMatches(err, /timeout exceeded when trying to connect|Connection terminated/i);',
        replace:
          '  return err instanceof Error && /timeout exceeded when trying to connect|Connection terminated/i.test(err.message);',
      },
    ],
    tests: [{ ...DB_UNIT, name: 'Drizzle wrapped' }],
  },
  {
    id: 'api-02-dev-login-allowed-in-production',
    group: 'api',
    title: 'dev login (sign in as anyone by email) can be enabled in production',
    edits: [
      {
        file: PS_CONFIG,
        find: "  .refine((c) => !c.AUTH_DEV_LOGIN_ENABLED || c.DEPLOYMENT_ENVIRONMENT !== 'production', {",
        replace: '  .refine((c) => c.AUTH_DEV_LOGIN_ENABLED || !c.AUTH_DEV_LOGIN_ENABLED, {',
      },
    ],
    tests: [{ ...PS_UNIT, name: 'refuses dev login' }],
  },
  {
    id: 'api-03-statement-timeout-is-500',
    group: 'api',
    title:
      'a statement cancelled by statement_timeout (rolled back, safe to retry) is answered 500',
    edits: [{ file: DB_ERRORS, find: "  '57014',\n", replace: '' }],
    tests: [{ ...DB_UNIT, name: 'statement timeout' }],
  },
  {
    id: 'api-04-timed-out-mutation-reported-as-safe-to-retry',
    group: 'api',
    title:
      'a mutation whose database response timed out is answered 503 (retry is safe) instead of 504 OUTCOME_UNKNOWN',
    edits: [
      {
        file: PS_ERRORS,
        find: "          : new AppError(504, 'OUTCOME_UNKNOWN', OUTCOME_UNKNOWN_MESSAGE),",
        replace:
          "          : new AppError(503, 'DEPENDENCY_UNAVAILABLE', OUTCOME_UNKNOWN_MESSAGE),",
      },
    ],
    tests: [{ ...PS_ERRORS_UNIT, name: 'timed-out mutation' }],
  },
  {
    id: 'api-05-idempotency-key-not-checked',
    group: 'api',
    title: 'a retried create with the same Idempotency-Key creates a second task',
    edits: [
      {
        file: PS_IDEMPOTENCY,
        find: '  if (!idempotency) return create();',
        replace: '  if (!idempotency || idempotency) return create();',
      },
    ],
    tests: [{ ...PS, files: ['test/idempotency.int.test.ts'], name: 'replays the first response' }],
  },
  {
    id: 'outbox-11-retention-deletes-pending-events',
    group: 'outbox',
    title: 'outbox retention deletes old events that were never published (lost events)',
    edits: [
      {
        file: OUTBOX,
        find: '      WHERE published_at IS NOT NULL\n        AND published_at < now()',
        replace:
          '      WHERE (published_at IS NOT NULL OR published_at IS NULL)\n        AND coalesce(published_at, created_at) < now()',
      },
    ],
    tests: [{ ...PUB, files: ['test/retention.int.test.ts'], name: 'never pending ones' }],
  },
  {
    id: 'api-06-rate-limit-shared-by-all-users',
    group: 'api',
    title: 'every authenticated user shares one rate-limit bucket (one busy user blocks everyone)',
    edits: [
      {
        file: GATEWAY_APP,
        find: "    return `user:${createHash('sha256').update(auth.slice(7)).digest('hex').slice(0, 32)}`;",
        replace: "    return 'user:everyone';",
      },
    ],
    tests: [{ ...GATEWAY_UNIT, name: 'limits each user separately' }],
  },
];
