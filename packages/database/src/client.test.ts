import { describe, expect, it } from 'vitest';
import { createDatabase } from './client.js';

describe('database pool', () => {
  // Creating the pool opens no connection, so no database is needed.
  const options = (idleTimeoutMs?: number) => {
    const handle = createDatabase({
      connectionString: 'postgres://user:password@localhost:1/db',
      applicationName: 'test',
      ...(idleTimeoutMs === undefined ? {} : { idleTimeoutMs }),
    });
    const { idleTimeoutMillis } = (
      handle.pool as unknown as { options: { idleTimeoutMillis: number } }
    ).options;
    void handle.close();
    return idleTimeoutMillis;
  };

  it('keeps idle connections open by default, so steady load does not reconnect', () => {
    expect(options()).toBe(0);
  });

  it('still accepts an explicit idle timeout', () => {
    expect(options(30_000)).toBe(30_000);
  });
});
