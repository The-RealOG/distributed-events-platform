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

// Phases 6-7 (activity projection, shared board cache)
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
    // Not awaiting the handler lets KafkaJS resolve (and auto-commit) the offset before the
    // handler's DB transaction commits or fails. A first version, a manual commitOffsets before
    // the handler, was masked by KafkaJS re-committing its own resolved offset and survived.
    id: 'p5-05-offset-committed-before-processing',
    phase: 5,
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
  // ---------------------------------------------------------------- Phase 6
  {
    id: 'p6-baseline',
    phase: 6,
    title: 'no mutation: activity suites pass',
    edits: [],
    tests: [...ACT_TESTS, ...PS_ACTIVITY],
    expect: 'pass',
  },
  {
    id: 'p6-01-bypasses-phase5-dedupe',
    phase: 6,
    title: 'activity worker writes directly, without processEventOnce',
    edits: [{ file: ACT_WORKER, find: ACT_HANDLER, replace: DIRECT_HANDLER }],
    tests: ACT_TESTS,
  },
  {
    id: 'p6-02-duplicate-creates-duplicate-activity',
    phase: 6,
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
    id: 'p6-03-marker-commits-activity-rolls-back',
    phase: 6,
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
    id: 'p6-04-activity-commits-marker-does-not',
    phase: 6,
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
    id: 'p6-05-offset-before-db-transaction',
    phase: 6,
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
    id: 'p6-06-activity-authorization-removed',
    phase: 6,
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
    id: 'p6-07-wrong-project-id',
    phase: 6,
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
    id: 'p6-08-correlation-lost',
    phase: 6,
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
    id: 'p6-09-request-path-writes-activity',
    phase: 6,
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
    id: 'p6-10-unstable-consumer-name',
    phase: 6,
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
  // ---------------------------------------------------------------- Phase 7
  {
    id: 'p7-baseline',
    phase: 7,
    title: 'no mutation: cache suites pass',
    edits: [],
    tests: [CACHE_UNIT, CACHE_INT, INV_UNIT, SYSTEM_P67],
    expect: 'pass',
  },
  {
    id: 'p7-01-wrong-cache-key',
    phase: 7,
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
    id: 'p7-02-update-not-invalidated',
    phase: 7,
    title: 'task.updated does not invalidate the board',
    edits: [
      { file: INV_WORKER, find: "  'task.updated': true,", replace: "  'task.updated': false," },
    ],
    tests: [SYSTEM_P67],
  },
  {
    id: 'p7-03-invalidates-unrelated-projects',
    phase: 7,
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
    id: 'p7-04-redis-outage-500',
    phase: 7,
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
    id: 'p7-05-set-failure-breaks-read',
    phase: 7,
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
    id: 'p7-06-writes-depend-on-redis',
    phase: 7,
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
    id: 'p7-07-authorization-bypass-on-hit',
    phase: 7,
    title: 'the cached board is returned before the access check',
    edits: [
      {
        file: BOARD_SERVICE,
        find: '    await requireProjectRole(this.db, principal.userId, projectId, REQUIRED_ROLE.readProject);\n    if (options.fresh) {',
        replace: '    if (options.fresh) {',
      },
    ],
    tests: [SYSTEM_P67],
  },
  {
    id: 'p7-08-invalidator-cannot-catch-up',
    phase: 7,
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
    id: 'p7-09-corrupt-entry-crashes',
    phase: 7,
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
    id: 'p7-10-no-ttl',
    phase: 7,
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
    id: 'p7-11-stale-write-back',
    phase: 7,
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
    id: 'p7-12-no-read-your-writes',
    phase: 7,
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
];
