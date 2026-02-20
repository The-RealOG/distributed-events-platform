import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';

const exec = promisify(execFile);

export interface StartedPostgres {
  url: string;
  containerId: string;
  stop(): Promise<void>;
}

/** Starts a throwaway PostgreSQL matching the Compose/RDS major version. */
export async function startPostgres(): Promise<StartedPostgres> {
  const container = await new PostgreSqlContainer('postgres:17-alpine').start();
  return {
    url: container.getConnectionUri(),
    containerId: container.getId(),
    stop: async () => {
      await container.stop();
    },
  };
}

/**
 * Creates an empty database on the same server and returns its URL, so test files that each
 * need exclusive use of a table (e.g. an outbox that a publisher drains completely) do not
 * interfere when they run in parallel.
 */
export async function createIsolatedDatabase(serverUrl: string): Promise<string> {
  const name = `test_${randomUUID().replace(/-/g, '')}`;
  const client = new pg.Client({ connectionString: serverUrl });
  await client.connect();
  try {
    await client.query(`CREATE DATABASE ${name}`);
  } finally {
    await client.end();
  }
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

/** Freezes the database container (connections hang) and resumes it: a realistic outage. */
export const pauseContainer = async (id: string) => void (await exec('docker', ['pause', id]));
export const unpauseContainer = async (id: string) => void (await exec('docker', ['unpause', id]));
