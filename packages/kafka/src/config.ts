import { z } from 'zod';

/** Kafka connection settings shared by every Kafka-using process. */
export const kafkaEnvSchema = z.object({
  // Comma-separated host:port list. Inside Compose: kafka:9092. From the host: localhost:9094.
  KAFKA_BROKERS: z
    .string()
    .min(1)
    .transform((value) =>
      value
        .split(',')
        .map((b) => b.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().regex(/^[^\s:]+:\d+$/, 'must be host:port')).min(1)),
  KAFKA_CLIENT_ID: z.string().min(1),
});
export type KafkaEnv = z.infer<typeof kafkaEnvSchema>;
