import { GenericContainer, Wait } from 'testcontainers';
import { pauseContainer, unpauseContainer } from './postgres.js';

/** Same engine family as ElastiCache (Valkey, Redis-protocol compatible). */
export const REDIS_IMAGE = 'valkey/valkey:8-alpine';

export interface StartedRedis {
  url: string;
  /** Freeze the server (connections hang, like a network partition) / thaw it. */
  pause(): Promise<void>;
  unpause(): Promise<void>;
  stop(): Promise<void>;
}

export async function startRedis(): Promise<StartedRedis> {
  const container = await new GenericContainer(REDIS_IMAGE)
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start();
  const id = container.getId();
  return {
    url: `redis://${container.getHost()}:${container.getMappedPort(6379)}`,
    pause: () => pauseContainer(id),
    unpause: () => unpauseContainer(id),
    stop: async () => {
      await container.stop();
    },
  };
}
