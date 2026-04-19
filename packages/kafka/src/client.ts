import { Kafka, logLevel, type KafkaConfig, type RetryOptions, type SASLOptions } from 'kafkajs';
import type { Logger } from 'pino';
import type { KafkaConnection } from './config.js';

/** Returns a fresh MSK IAM token (a SigV4-signed, short-lived OAUTHBEARER token). */
export type IamTokenProvider = (region: string) => Promise<string>;

/**
 * Default provider: AWS's official signer, which resolves credentials through the standard AWS
 * chain (the ECS task role in AWS). Imported lazily so local development never loads it.
 */
const awsIamToken: IamTokenProvider = async (region) => {
  const { generateAuthToken } = await import('aws-msk-iam-sasl-signer-js');
  const { token } = await generateAuthToken({ region });
  return token;
};

/** Transport + authentication part of the KafkaJS config for a connection. */
export function connectionConfig(
  connection: Pick<KafkaConnection, 'ssl' | 'auth'>,
  tokenProvider: IamTokenProvider = awsIamToken,
): Pick<KafkaConfig, 'ssl' | 'sasl'> {
  if (connection.auth.mechanism === 'aws-iam') {
    const { region } = connection.auth;
    const sasl: SASLOptions = {
      mechanism: 'oauthbearer',
      // Called on every (re)authentication, so tokens never go stale.
      oauthBearerProvider: async () => ({ value: await tokenProvider(region) }),
    };
    return { ssl: true, sasl };
  }
  return connection.ssl ? { ssl: true } : {};
}

export interface KafkaClientOptions {
  clientId: string;
  brokers: string[];
  logger: Logger;
  /** TLS and authentication (defaults: plaintext, no auth, as for the local broker). */
  ssl?: KafkaConnection['ssl'];
  auth?: KafkaConnection['auth'];
  /** Per-connection TCP connect timeout. */
  connectionTimeoutMs?: number;
  /** Per-request timeout once connected. */
  requestTimeoutMs?: number;
  /**
   * KafkaJS's own retry policy, used for connecting and for producer sends. Bounded so a
   * failed publish surfaces to the caller in seconds instead of KafkaJS's default of about
   * 30 s: roughly 250 + 500 + 1000 + 2000 ms of backoff (with jitter) plus connect attempts.
   */
  retry?: RetryOptions;
}

export const DEFAULT_RETRY: RetryOptions = {
  initialRetryTime: 250,
  maxRetryTime: 2_000,
  retries: 4,
};

const PINO_LEVEL: Record<logLevel, 'error' | 'warn' | 'info' | 'debug' | undefined> = {
  [logLevel.NOTHING]: undefined,
  [logLevel.ERROR]: 'error',
  [logLevel.WARN]: 'warn',
  [logLevel.INFO]: 'info',
  [logLevel.DEBUG]: 'debug',
};

export function createKafkaClient(options: KafkaClientOptions): Kafka {
  const log = options.logger.child({ component: 'kafkajs' });
  return new Kafka({
    clientId: options.clientId,
    brokers: options.brokers,
    ...connectionConfig({ ssl: options.ssl ?? false, auth: options.auth ?? { mechanism: 'none' } }),
    connectionTimeout: options.connectionTimeoutMs ?? 3_000,
    requestTimeout: options.requestTimeoutMs ?? 10_000,
    retry: options.retry ?? DEFAULT_RETRY,
    logLevel: logLevel.INFO,
    // Route KafkaJS's internal logs through Pino so they are structured like everything else.
    logCreator:
      () =>
      ({ namespace, level, log: entry }) => {
        const pinoLevel = PINO_LEVEL[level];
        if (!pinoLevel) return;
        const { message, timestamp: _timestamp, logger: _logger, ...fields } = entry;
        log[pinoLevel]({ namespace, ...fields }, message);
      },
  });
}
