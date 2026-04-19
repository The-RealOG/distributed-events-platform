import { z } from 'zod';

/** Kafka connection settings shared by every Kafka-using process. */
export const kafkaEnvSchema = z.object({
  // Comma-separated host:port list. Compose: kafka:9092. Host: localhost:9094. MSK: the
  // bootstrap brokers for IAM auth (port 9098).
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
  // TLS to the brokers. Off for the local plaintext broker; on for MSK.
  KAFKA_SSL: z.stringbool().default(false),
  // none: local plaintext broker. aws-iam: MSK IAM (SASL/OAUTHBEARER signed with the process's
  // AWS credentials, e.g. the ECS task role). Requires KAFKA_SSL and AWS_REGION.
  KAFKA_AUTH: z.enum(['none', 'aws-iam']).default('none'),
  AWS_REGION: z.string().min(1).optional(),
});
export type KafkaEnv = z.infer<typeof kafkaEnvSchema>;

export interface KafkaConnection {
  clientId: string;
  brokers: string[];
  ssl: boolean;
  auth: { mechanism: 'none' } | { mechanism: 'aws-iam'; region: string };
}

/** Maps validated env to connection settings, failing fast on inconsistent combinations. */
export function kafkaConnectionFromEnv(env: KafkaEnv): KafkaConnection {
  if (env.KAFKA_AUTH === 'aws-iam') {
    if (!env.KAFKA_SSL) throw new Error('KAFKA_AUTH=aws-iam requires KAFKA_SSL=true');
    if (!env.AWS_REGION) throw new Error('KAFKA_AUTH=aws-iam requires AWS_REGION');
    return {
      clientId: env.KAFKA_CLIENT_ID,
      brokers: env.KAFKA_BROKERS,
      ssl: true,
      auth: { mechanism: 'aws-iam', region: env.AWS_REGION },
    };
  }
  return {
    clientId: env.KAFKA_CLIENT_ID,
    brokers: env.KAFKA_BROKERS,
    ssl: env.KAFKA_SSL,
    auth: { mechanism: 'none' },
  };
}
