import type { FastifyInstance } from 'fastify';
import { WebSocket, WebSocketServer, type RawData } from 'ws';

export const REALTIME_PATH = '/api/realtime';

export interface RealtimeProxyOptions {
  /** Internal realtime-service base URL (http://…); the socket goes to <url>/realtime. */
  upstreamUrl: string;
  /** Browser origins allowed to open the socket (WebSockets are not covered by CORS). */
  allowedOrigins: string[];
  /** Close a browser that falls this far behind (it reconnects and refetches). */
  maxBufferedBytes?: number;
  /** Ping interval towards the browser: keeps idle connections open through the ALB (60 s). */
  heartbeatMs?: number;
}

/** WebSocket close codes that may be sent on the wire (1005/1006 are reserved). */
const sendable = (code: number) => (code === 1005 || code === 1006 || code < 1000 ? 1000 : code);

/**
 * /api/realtime: relays a browser WebSocket to the realtime-service, frame for frame. The
 * gateway stays thin: no auth here (the realtime-service authenticates the first message),
 * just origin checking, bounded buffering and heartbeats.
 */
export function registerRealtimeProxy(app: FastifyInstance, options: RealtimeProxyOptions): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  const target = `${options.upstreamUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/realtime`;
  const maxBuffered = options.maxBufferedBytes ?? 1024 * 1024;
  const heartbeatMs = options.heartbeatMs ?? 20_000;

  app.server.on('upgrade', (request, socket, head) => {
    const path = new URL(request.url ?? '/', 'http://gateway').pathname;
    if (path !== REALTIME_PATH) {
      socket.destroy();
      return;
    }
    const origin = request.headers.origin;
    if (origin && options.allowedOrigins.length > 0 && !options.allowedOrigins.includes(origin)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(request, socket, head, (client) => {
      const upstream = new WebSocket(target, { maxPayload: 64 * 1024 });
      const early: { data: RawData; binary: boolean }[] = [];
      let alive = true;
      const ping = setInterval(() => {
        if (!alive) return client.terminate();
        alive = false;
        client.ping();
      }, heartbeatMs);
      client.on('pong', () => (alive = true));

      upstream.on('open', () => {
        for (const m of early.splice(0)) upstream.send(m.data, { binary: m.binary });
      });
      client.on('message', (data, binary) => {
        if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary });
        else if (early.length < 8) early.push({ data, binary });
        else client.close(1013, 'try again');
      });
      upstream.on('message', (data, binary) => {
        if (client.bufferedAmount > maxBuffered) {
          client.close(4429, 'too slow; reconnect and refetch');
          return;
        }
        client.send(data, { binary });
      });
      client.on('close', (code) => {
        clearInterval(ping);
        if (upstream.readyState === WebSocket.CONNECTING) upstream.terminate();
        else upstream.close(sendable(code));
      });
      upstream.on('close', (code, reason) => client.close(sendable(code), reason));
      upstream.on('error', () => client.close(1011, 'realtime unavailable'));
      client.on('error', () => upstream.terminate());
    });
  });
  app.addHook('onClose', async () => {
    for (const client of wss.clients) client.close(1001, 'gateway shutting down');
    wss.close();
  });
}
