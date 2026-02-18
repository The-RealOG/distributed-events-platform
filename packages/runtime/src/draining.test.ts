import { Agent, request } from 'node:http';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { closeConnectionsWhenDraining } from './index.js';

// How long close() may take after the in-flight response before we call it "hung". Without the
// fix, close() waits for the client's keep-alive timeout (60 s here), so any generous window
// separates the two outcomes without depending on machine speed.
const HUNG_AFTER_MS = 3_000;

async function closeCompletes(withDraining: boolean): Promise<boolean> {
  const app = Fastify();
  if (withDraining) closeConnectionsWhenDraining(app);

  let markArrived!: () => void;
  const arrived = new Promise<void>((resolve) => (markArrived = resolve));
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  app.get('/slow', async () => {
    markArrived();
    await released;
    return { ok: true };
  });
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = new URL(address);

  // A keep-alive client, like the gateway's upstream pool.
  const agent = new Agent({ keepAlive: true, keepAliveMsecs: 60_000 });
  const responded = new Promise<void>((resolve, reject) => {
    request({ port, path: '/slow', agent }, (res) => res.resume().on('end', resolve))
      .on('error', reject)
      .end();
  });

  // The failure needs this exact order: request in flight → the HTTP server starts closing →
  // only then does the response finish. Release the handler from inside server.close() so the
  // order holds regardless of machine speed. (Releasing before close() is reached lets the
  // response finish first, and the idle-connection cleanup then masks the bug.)
  await arrived;
  const serverClose = app.server.close.bind(app.server);
  app.server.close = (callback?: (err?: Error) => void) => {
    const result = serverClose(callback);
    setImmediate(release);
    return result;
  };
  const closed = app.close();
  await responded;

  const completed = await Promise.race([
    closed.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), HUNG_AFTER_MS)),
  ]);
  agent.destroy();
  await closed;
  return completed;
}

describe('closeConnectionsWhenDraining', () => {
  it('lets close() finish after the in-flight response on a keep-alive connection', async () => {
    expect(await closeCompletes(true)).toBe(true);
  });

  it('is needed: without it close() waits on the now-idle keep-alive socket', async () => {
    expect(await closeCompletes(false)).toBe(false);
  });
});
