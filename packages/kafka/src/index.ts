export { createKafkaClient, DEFAULT_RETRY, type KafkaClientOptions } from './client.js';
export { kafkaEnvSchema, type KafkaEnv } from './config.js';
export {
  DomainEventConsumer,
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
