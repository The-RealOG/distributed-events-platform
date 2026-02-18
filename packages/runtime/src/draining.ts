import type { FastifyInstance } from 'fastify';

/**
 * Makes keep-alive connections end once their in-flight response is written after shutdown
 * begins. Fastify only closes connections that are idle at the moment close() starts; a
 * connection busy with a request becomes idle afterwards and would otherwise hold close()
 * open until the client's keep-alive expires (the gateway's upstream pool keeps such
 * connections to every service), turning a graceful shutdown into a forced one.
 */
export function closeConnectionsWhenDraining(app: FastifyInstance): void {
  let draining = false;
  app.addHook('preClose', async () => {
    draining = true;
  });
  app.addHook('onSend', async (_request, reply, payload) => {
    if (draining) void reply.header('connection', 'close');
    return payload;
  });
}
