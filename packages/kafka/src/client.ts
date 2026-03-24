import { Kafka, logLevel, type RetryOptions } from 'kafkajs';
import type { Logger } from 'pino';

export interface KafkaClientOptions {
  clientId: string;
  brokers: string[];
  logger: Logger;
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
