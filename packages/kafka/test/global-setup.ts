import { startKafka, waitForKafka } from '@dpp/test-utils';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    kafkaBrokers: string[];
  }
}

/**
 * Starts a throwaway broker, or reuses one given in KAFKA_TEST_BROKERS (e.g. the Compose
 * broker at localhost:9094) to make repeated local runs faster. Tests create uniquely named
 * topics and groups, so sharing a broker cannot leak state between them. The recovery test
 * always starts its own broker because it stops and restarts it.
 */
export default async function setup(project: TestProject) {
  const shared = process.env['KAFKA_TEST_BROKERS'];
  if (shared) {
    const brokers = shared.split(',').map((b) => b.trim());
    await waitForKafka(brokers);
    project.provide('kafkaBrokers', brokers);
    return;
  }
  const kafka = await startKafka();
  project.provide('kafkaBrokers', kafka.brokers);
  return () => kafka.stop();
}
