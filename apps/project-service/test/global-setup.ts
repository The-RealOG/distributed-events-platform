import { runMigrations } from '@dpp/database';
import { startPostgres } from '@dpp/test-utils';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

export default async function setup(project: TestProject) {
  const postgres = await startPostgres();
  await runMigrations(postgres.url);
  project.provide('databaseUrl', postgres.url);
  return () => postgres.stop();
}
