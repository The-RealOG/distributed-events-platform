import { startKafka, startPostgres, waitForKafka } from '@dpp/test-utils';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    postgresUrl: string;
    postgresContainerId: string;
    kafkaBrokers: string[];
  }
}

export default async function setup(project: TestProject) {
  const postgres = await startPostgres();
  project.provide('postgresUrl', postgres.url);
  project.provide('postgresContainerId', postgres.containerId);

  // KAFKA_TEST_BROKERS reuses a running broker (e.g. Compose's) for faster local runs.
  const shared = process.env['KAFKA_TEST_BROKERS'];
  let stopKafka = async () => {};
  if (shared) {
    const brokers = shared.split(',');
    await waitForKafka(brokers);
    project.provide('kafkaBrokers', brokers);
  } else {
    const kafka = await startKafka();
    project.provide('kafkaBrokers', kafka.brokers);
    stopKafka = () => kafka.stop();
  }
  return async () => {
    await stopKafka();
    await postgres.stop();
  };
}
