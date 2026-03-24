import type { Admin, ITopicConfig } from 'kafkajs';

export interface TopicSpec {
  name: string;
  numPartitions: number;
  replicationFactor: number;
  config: Record<string, string>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The only topics this platform uses. One shared topic for all domain events keeps
 * per-project ordering in one place: events for a project share a key, and therefore a
 * partition, regardless of their type. Separate per-type topics would lose that ordering.
 *
 * domain.events has 3 partitions locally: enough to demonstrate key-based partitioning and to
 * spread a consumer group across more than one member. Production would size this for
 * throughput; partitions can be added later, but doing so remaps keys (see ADR-010).
 */
export const TOPICS = {
  domainEvents: {
    name: 'domain.events',
    numPartitions: 3,
    replicationFactor: 1,
    config: { 'retention.ms': String(7 * DAY_MS), 'cleanup.policy': 'delete' },
  },
  domainEventsDlq: {
    name: 'domain.events.dlq',
    numPartitions: 1,
    replicationFactor: 1,
    config: { 'retention.ms': String(30 * DAY_MS), 'cleanup.policy': 'delete' },
  },
} as const satisfies Record<string, TopicSpec>;

export class TopicMismatchError extends Error {
  constructor(topic: string, expected: number, actual: number) {
    super(`Topic ${topic} has ${actual} partitions but ${expected} are required`);
    this.name = 'TopicMismatchError';
  }
}

/**
 * Creates missing topics and verifies existing ones. Safe to run on every startup. It never
 * changes an existing topic: a partition-count mismatch is reported, not "fixed", because
 * adding partitions silently remaps keys to partitions.
 */
const isRetriable = (err: unknown) => (err as { retriable?: unknown }).retriable === true;

export async function ensureTopics(
  admin: Admin,
  specs: readonly TopicSpec[],
  { timeoutMs = 60_000 } = {},
): Promise<{ created: string[]; existing: string[] }> {
  const existingNames = new Set(await admin.listTopics());
  const missing = specs.filter((s) => !existingNames.has(s.name));

  if (missing.length > 0) {
    const topics: ITopicConfig[] = missing.map((s) => ({
      topic: s.name,
      numPartitions: s.numPartitions,
      replicationFactor: s.replicationFactor,
      configEntries: Object.entries(s.config).map(([name, value]) => ({ name, value })),
    }));
    try {
      await admin.createTopics({ topics, waitForLeaders: true });
    } catch (err) {
      // Already created by a concurrent initializer: fine. A retriable error (metadata not yet
      // propagated on a busy broker) is fine too: the verification below waits it out.
      if ((err as { type?: string }).type !== 'TOPIC_ALREADY_EXISTS' && !isRetriable(err))
        throw err;
    }
  }

  // Verify, waiting (bounded) until every partition exists and has a leader. Freshly created
  // topics can briefly report UNKNOWN_TOPIC_OR_PARTITION / NOT_LEADER on a loaded broker.
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const metadata = await admin.fetchTopicMetadata({ topics: specs.map((s) => s.name) });
      let settled = true;
      for (const spec of specs) {
        const topic = metadata.topics.find((t) => t.name === spec.name);
        const actual = topic?.partitions.length ?? 0;
        if (actual > 0 && actual !== spec.numPartitions) {
          throw new TopicMismatchError(spec.name, spec.numPartitions, actual);
        }
        if (actual === 0 || topic!.partitions.some((p) => p.leader < 0)) settled = false;
      }
      if (settled) break;
    } catch (err) {
      if (err instanceof TopicMismatchError || !isRetriable(err) || Date.now() > deadline)
        throw err;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Topics not ready within ${timeoutMs} ms: ${specs.map((s) => s.name).join(', ')}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return {
    created: missing.map((s) => s.name),
    existing: specs.filter((s) => existingNames.has(s.name)).map((s) => s.name),
  };
}
