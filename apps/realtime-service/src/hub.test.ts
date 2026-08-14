import { EventEmitter } from 'node:events';
import { REALTIME_CLOSE, type RealtimeEnvelope } from '@dpp/contracts';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { Hub } from './hub.js';

class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  bufferedAmount = 0;
  sent: string[] = [];
  closed: { code: number; reason: string } | undefined;
  send(data: string) {
    this.sent.push(data);
  }
  close(code: number, reason: string) {
    this.closed = { code, reason };
    this.readyState = 3;
  }
  ping() {}
  terminate() {
    this.readyState = 3;
  }
}

const hub = (maxBufferedBytes = 1_000_000, recentEvents?: number) =>
  new Hub({
    logger: pino({ level: 'silent' }),
    maxBufferedBytes,
    heartbeatMs: 60_000,
    ...(recentEvents ? { recentEvents } : {}),
  });
const envelope = (projectId: string, eventId = crypto.randomUUID()): RealtimeEnvelope => ({
  type: 'task.moved',
  eventId,
  projectId,
  aggregateId: crypto.randomUUID(),
  aggregateVersion: 2,
  taskId: crypto.randomUUID(),
  actorId: crypto.randomUUID(),
  correlationId: 'c',
  occurredAt: new Date().toISOString(),
});
const add = (h: Hub) => {
  const socket = new FakeSocket();
  return { socket, client: h.add(socket as unknown as WebSocket) };
};

describe('Hub', () => {
  const [pA, pB] = [crypto.randomUUID(), crypto.randomUUID()];

  it('sends only to the event’s project room', () => {
    const h = hub();
    const [a, b] = [add(h), add(h)];
    h.join(a.client, pA);
    h.join(b.client, pB);
    expect(h.broadcast(envelope(pA))).toBe(1);
    expect(a.socket.sent).toHaveLength(1);
    expect(b.socket.sent).toHaveLength(0);
  });

  it('removes a client from every room on disconnect and deletes empty rooms', () => {
    const h = hub();
    const a = add(h);
    h.join(a.client, pA);
    h.join(a.client, pB);
    expect(h.rooms).toBe(2);
    h.remove(a.client);
    expect([h.connections, h.rooms, h.membersOf(pA)]).toEqual([0, 0, 0]);
  });

  it('closes a client whose send buffer is over the limit instead of queueing more', () => {
    const h = hub(1_000);
    const a = add(h);
    h.join(a.client, pA);
    a.socket.bufferedAmount = 5_000;
    expect(h.broadcast(envelope(pA))).toBe(0);
    expect(a.socket.closed?.code).toBe(REALTIME_CLOSE.slowClient);
    expect(h.counters.slowClientDisconnects).toBe(1);
    expect(h.membersOf(pA)).toBe(0);
  });

  it('suppresses duplicates within a bounded window (memory does not grow without limit)', () => {
    const h = hub(1_000_000, 3);
    const a = add(h);
    h.join(a.client, pA);
    const first = envelope(pA);
    h.broadcast(first);
    h.broadcast(first);
    expect(a.socket.sent).toHaveLength(1);
    for (let i = 0; i < 3; i++) h.broadcast(envelope(pA)); // pushes `first` out of the window
    h.broadcast(first);
    expect(a.socket.sent).toHaveLength(5);
    expect(h.counters.duplicatesSuppressed).toBe(1);
  });

  it('terminates connections that miss a heartbeat', () => {
    vi.useFakeTimers();
    try {
      const h = new Hub({
        logger: pino({ level: 'silent' }),
        maxBufferedBytes: 1e6,
        heartbeatMs: 1_000,
      });
      const [alive, dead] = [add(h), add(h)];
      h.join(dead.client, pA);
      h.startHeartbeat();
      vi.advanceTimersByTime(1_000); // ping round 1
      alive.socket.emit('pong');
      vi.advanceTimersByTime(1_000); // dead missed it
      expect(h.connections).toBe(1);
      expect(h.membersOf(pA)).toBe(0);
      expect(h.counters.heartbeatTerminations).toBe(1);
      h.closeAll(REALTIME_CLOSE.goingAway, 'bye');
    } finally {
      vi.useRealTimers();
    }
  });
});
