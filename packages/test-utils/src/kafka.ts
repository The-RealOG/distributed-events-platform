import { execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { promisify } from 'node:util';
import { Kafka, logLevel } from 'kafkajs';
import { GenericContainer, Wait } from 'testcontainers';
import { waitFor } from './wait.js';

const exec = promisify(execFile);

export const KAFKA_IMAGE = 'apache/kafka:4.1.1';

export interface StartedKafka {
  brokers: string[];
  /** `docker stop` the broker, keeping the container (and its data and port) for restart. */
  stopBroker(): Promise<void>;
  /** `docker start` it again and wait until it serves metadata. */
  startBroker(): Promise<void>;
  stop(): Promise<void>;
}

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

/** Resolves once the broker answers a metadata request. */
export async function waitForKafka(brokers: string[], timeoutMs = 60_000): Promise<void> {
  const kafka = new Kafka({
    clientId: 'wait-for-kafka',
    brokers,
    logLevel: logLevel.NOTHING,
    connectionTimeout: 1_000,
    retry: { retries: 0 },
  });
  await waitFor(
    async () => {
      const admin = kafka.admin();
      try {
        await admin.connect();
        await admin.listTopics();
        return true;
      } finally {
        await admin.disconnect().catch(() => undefined);
      }
    },
    { timeoutMs, intervalMs: 500, description: `Kafka at ${brokers.join(',')}` },
  );
}

/**
 * A single-node KRaft broker configured like the Compose one. The host port is fixed up front
 * because Kafka advertises it to clients: a stop/start cycle must come back on the same
 * address for reconnection to be meaningful to test.
 */
export async function startKafka(): Promise<StartedKafka> {
  const hostPort = await freePort();
  const container = await new GenericContainer(KAFKA_IMAGE)
    .withEnvironment({
      KAFKA_NODE_ID: '1',
      KAFKA_PROCESS_ROLES: 'broker,controller',
      KAFKA_CONTROLLER_QUORUM_VOTERS: '1@localhost:9093',
      KAFKA_LISTENERS: 'PLAINTEXT://:9092,CONTROLLER://:9093,EXTERNAL://:9094',
      KAFKA_ADVERTISED_LISTENERS: `PLAINTEXT://localhost:9092,EXTERNAL://localhost:${hostPort}`,
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP:
        'PLAINTEXT:PLAINTEXT,CONTROLLER:PLAINTEXT,EXTERNAL:PLAINTEXT',
      KAFKA_CONTROLLER_LISTENER_NAMES: 'CONTROLLER',
      KAFKA_INTER_BROKER_LISTENER_NAME: 'PLAINTEXT',
      CLUSTER_ID: 'dpp-test-kraft-cluster01',
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: '1',
      KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: '1',
      KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: '1',
      KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS: '0',
      KAFKA_AUTO_CREATE_TOPICS_ENABLE: 'false',
      KAFKA_HEAP_OPTS: '-Xms256m -Xmx512m',
    })
    .withExposedPorts({ container: 9094, host: hostPort })
    .withWaitStrategy(Wait.forLogMessage(/Kafka Server started/))
    .withStartupTimeout(180_000)
    .start();

  const brokers = [`localhost:${hostPort}`];
  await waitForKafka(brokers);
  const id = container.getId();

  return {
    brokers,
    stopBroker: async () => {
      await exec('docker', ['stop', '--time', '10', id]);
    },
    startBroker: async () => {
      await exec('docker', ['start', id]);
      // A KRaft broker restart took over 2 minutes on a saturated laptop.
      await waitForKafka(brokers, 240_000);
    },
    stop: async () => {
      await container.stop();
    },
  };
}
