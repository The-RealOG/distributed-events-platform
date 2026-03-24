import { Partitioners } from 'kafkajs';

/**
 * The partitioner every producer in this platform uses: KafkaJS's DefaultPartitioner, which
 * is murmur2-compatible with the Java client. Keys map to the same partitions whichever client
 * produces them. (KafkaJS's newer default in v2 is this one; setting it explicitly also
 * silences its migration warning.)
 */
export const createPartitioner = Partitioners.DefaultPartitioner;

/** Which partition a key maps to, for a topic with `numPartitions` partitions. */
export function partitionFor(key: string, numPartitions: number, topic = 'any'): number {
  const partition = createPartitioner()({
    topic,
    // Only the partition count matters for keyed messages; the rest satisfies the type.
    partitionMetadata: Array.from({ length: numPartitions }, (_, i) => ({
      partitionErrorCode: 0,
      partitionId: i,
      leader: 0,
      replicas: [0],
      isr: [0],
    })),
    message: { key, value: null },
  });
  return partition;
}
