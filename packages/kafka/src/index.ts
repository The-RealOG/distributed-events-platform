export {
  connectionConfig,
  createKafkaClient,
  DEFAULT_RETRY,
  type IamTokenProvider,
  type KafkaClientOptions,
} from './client.js';
export {
  kafkaConnectionFromEnv,
  kafkaEnvSchema,
  type KafkaConnection,
  type KafkaEnv,
} from './config.js';
export {
  DomainEventConsumer,
  RedeliverError,
  type ConsumerHooks,
  type DomainEventConsumerOptions,
  type EventHandler,
  type MessageMetadata,
} from './consumer.js';
export { encodeDomainEvent, headersToStrings } from './encoding.js';
export { createPartitioner, partitionFor } from './partitioning.js';
export {
  DomainEventProducer,
  ProducerClosedError,
  PublishError,
  type DomainEventProducerOptions,
  type PublishResult,
} from './producer.js';
export { ensureTopics, TopicMismatchError, TOPICS, type TopicSpec } from './topics.js';
export {
  classifyFailure,
  DEFAULT_CONSUMER_RETRY,
  DLQ_RECORD_VERSION,
  PermanentEventError,
  retryDelayMs,
  sanitizeError,
  type DlqCategory,
  type DlqRecord,
  type FailureKind,
  type RetryPolicy,
} from './failures.js';
export { readDeadLetters, replayDeadLetters, type DeadLetter, type ReplayResult } from './dlq.js';
export { consumerMetricHooks } from './metrics.js';
