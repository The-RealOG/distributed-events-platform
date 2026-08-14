import { AuthenticationError, type AuthProvider } from '@dpp/auth';
import { REALTIME_CLOSE, realtimeClientMessage, type RealtimeServerMessage } from '@dpp/contracts';
import { projectReadAccess, type DatabaseHandle } from '@dpp/database';
import type { DomainEventConsumer } from '@dpp/kafka';
import {
  registerHttpMetrics,
  registerPoolMetrics,
  registerRequestContext,
  requestIdOptions,
  type Metrics,
} from '@dpp/observability';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type { Hub } from './hub.js';

export const SERVICE_NAME = 'realtime-service';

/** A WebSocket frame as text (ws delivers a Buffer, an ArrayBuffer or fragments). */
function frameText(raw: Buffer | ArrayBuffer | Buffer[]): string {
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8');
  return Buffer.isBuffer(raw) ? raw.toString('utf8') : Buffer.from(raw).toString('utf8');
}

export interface RealtimeDeps {
  logger: FastifyBaseLogger;
  database: DatabaseHandle;
  authProvider: AuthProvider;
  hub: Hub;
  consumer: DomainEventConsumer;
  authTimeoutMs: number;
  metrics?: Metrics;
}

/**
 * WebSocket endpoint GET /realtime (the gateway exposes it as /api/realtime) plus probes.
 *
 *   connect → {type:auth, token} within authTimeoutMs → ready
 *           → {type:subscribe, projectId} → membership check → subscribed | error
 *           → {type:event, event} notifications for subscribed projects
 *
 * The token is the same JWT the HTTP API uses, sent as the first message (never in the URL,
 * where proxies and access logs would keep it).
 */
export async function buildApp(deps: RealtimeDeps): Promise<FastifyInstance> {
  const { logger, database, authProvider, hub, consumer, metrics } = deps;
  const app = Fastify({
    loggerInstance: logger,
    ...requestIdOptions(),
  }) as unknown as FastifyInstance;
  registerRequestContext(app);
  await app.register(websocket, { options: { maxPayload: 16 * 1024 } });

  const counter = (name: string, help: string, labelNames: string[] = []) =>
    metrics?.counter({ name, help, labelNames });
  const opened = counter('realtime_connections_opened_total', 'WebSocket connections accepted');
  const closed = counter('realtime_connections_closed_total', 'WebSocket connections closed');
  const authFailures = counter('realtime_auth_failures_total', 'Rejected connections', ['reason']);
  const denied = counter('realtime_subscriptions_denied_total', 'Subscriptions refused', [
    'reason',
  ]);
  const subscribed = counter('realtime_subscriptions_total', 'Subscriptions accepted');
  if (metrics) {
    registerHttpMetrics(app, metrics);
    registerPoolMetrics(metrics, database.pool);
    metrics.gauge({
      name: 'realtime_connections',
      help: 'Open WebSocket connections on this replica',
      collect() {
        this.set(hub.connections);
      },
    });
    metrics.gauge({
      name: 'realtime_rooms',
      help: 'Projects with at least one local subscriber',
      collect() {
        this.set(hub.rooms);
      },
    });
    metrics.counter({
      name: 'realtime_hub_events_total',
      help: 'Hub delivery counters (broadcast = messages written to sockets)',
      labelNames: ['result'],
      collect() {
        this.reset();
        const c = hub.counters;
        for (const [result, value] of [
          ['broadcast', c.broadcast],
          ['send_failure', c.sendFailures],
          ['slow_client_disconnect', c.slowClientDisconnects],
          ['heartbeat_termination', c.heartbeatTerminations],
          ['duplicate_suppressed', c.duplicatesSuppressed],
        ] as const) {
          if (value > 0) this.inc({ result }, value);
        }
      },
    });
  }

  app.get('/health', () => ({ status: 'ok' }));
  app.get('/ready', async (_request, reply) => {
    const databaseOk = await database.ping().then(
      () => true,
      () => false,
    );
    return consumer.running && databaseOk
      ? { status: 'ready' }
      : reply
          .code(503)
          .send({ status: 'not_ready', consumer: consumer.running, database: databaseOk });
  });
  app.get('/status', () => ({
    consumer: consumer.running,
    connections: hub.connections,
    rooms: hub.rooms,
    counters: hub.counters,
  }));

  app.get('/realtime', { websocket: true }, (socket) => {
    const client = hub.add(socket);
    opened?.inc();
    const send = (message: RealtimeServerMessage) => socket.send(JSON.stringify(message));
    const reject = (reason: string) => {
      authFailures?.inc({ reason });
      socket.close(REALTIME_CLOSE.unauthenticated, 'unauthenticated');
    };
    const authTimer = setTimeout(() => {
      if (!client.userId) {
        authFailures?.inc({ reason: 'timeout' });
        socket.close(REALTIME_CLOSE.authTimeout, 'authenticate first');
      }
    }, deps.authTimeoutMs);

    socket.on('close', () => {
      clearTimeout(authTimer);
      hub.remove(client);
      closed?.inc();
    });

    socket.on('message', (raw) => {
      void (async () => {
        let parsed;
        try {
          parsed = realtimeClientMessage.safeParse(JSON.parse(frameText(raw)));
        } catch {
          parsed = undefined;
        }
        if (!parsed?.success) {
          if (!client.userId) return reject('malformed');
          return send({ type: 'error', code: 'BAD_MESSAGE', message: 'Unrecognised message' });
        }
        const message = parsed.data;
        if (!client.userId) {
          if (message.type !== 'auth') return reject('missing');
          try {
            const principal = await authProvider.authenticate(message.token);
            client.userId = principal.userId;
            clearTimeout(authTimer);
            send({ type: 'ready', userId: principal.userId });
          } catch (err) {
            reject(err instanceof AuthenticationError ? err.reason : 'invalid');
          }
          return;
        }
        if (message.type === 'auth') return;
        if (message.type === 'unsubscribe') return hub.leave(client, message.projectId);

        // Authorization on every subscription, against the database (never trusted from the UI).
        let access: Awaited<ReturnType<typeof projectReadAccess>>;
        try {
          access = await projectReadAccess(database.db, client.userId, message.projectId);
        } catch {
          return send({
            type: 'error',
            code: 'UNAVAILABLE',
            message: 'Try again',
            projectId: message.projectId,
          });
        }
        if (access !== 'allowed') {
          denied?.inc({ reason: access });
          return send({
            type: 'error',
            code: access === 'forbidden' ? 'FORBIDDEN' : 'NOT_FOUND',
            message: access === 'forbidden' ? 'Not a member of this project' : 'No such project',
            projectId: message.projectId,
          });
        }
        hub.join(client, message.projectId);
        subscribed?.inc();
        send({ type: 'subscribed', projectId: message.projectId });
      })();
    });
  });

  return app;
}
