import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RealtimeConnection, reconnectDelayMs, type RealtimeStatus } from './connection';

class FakeSocket {
  static all: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  sent: unknown[] = [];
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close(code = 1000) {
    this.onclose?.({ code });
  }
  // server side helpers
  open() {
    this.onopen?.();
  }
  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  drop(code = 1006) {
    this.onclose?.({ code });
  }
}

const projectId = '7f9e2c1a-1111-4222-8333-944455566677';
const userId = '1f9e2c1a-1111-4222-8333-944455566677';

function start(random = () => 0.5) {
  FakeSocket.all = [];
  const statuses: RealtimeStatus[] = [];
  const events: string[] = [];
  let resyncs = 0;
  const connection = new RealtimeConnection({
    url: 'ws://x/api/realtime',
    projectId,
    getToken: () => 'tok',
    onEvent: (e) => events.push(e.eventId),
    onResync: () => resyncs++,
    onStatus: (s) => statuses.push(s),
    WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
    backoff: { baseMs: 500, maxMs: 30_000 },
    random,
  });
  connection.start();
  const handshake = (socket = FakeSocket.all.at(-1)!) => {
    socket.open();
    socket.receive({ type: 'ready', userId });
    socket.receive({ type: 'subscribed', projectId });
  };
  return { connection, statuses, events, resyncs: () => resyncs, handshake };
}

describe('RealtimeConnection', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('authenticates first (token in a message, not the URL), then subscribes; resyncs when subscribed', () => {
    const t = start();
    t.handshake();
    const socket = FakeSocket.all[0]!;
    expect(socket.url).not.toContain('tok');
    expect(socket.sent).toEqual([
      { type: 'auth', token: 'tok' },
      { type: 'subscribe', projectId },
    ]);
    expect(t.statuses.at(-1)).toBe('live');
    expect(t.resyncs()).toBe(1);
  });

  it('reconnects with growing, capped, jittered delays and reconciles after every reconnect', () => {
    const t = start();
    t.handshake();
    const delays: number[] = [];
    for (let i = 0; i < 8; i++) {
      const before = FakeSocket.all.length;
      FakeSocket.all.at(-1)!.drop();
      let waited = 0;
      while (FakeSocket.all.length === before) {
        vi.advanceTimersByTime(50);
        waited += 50;
        if (waited > 60_000) throw new Error('never reconnected');
      }
      delays.push(waited);
    }
    // No immediate reconnect, growth, and a ceiling.
    expect(delays[0]).toBeGreaterThanOrEqual(350);
    expect(delays[3]!).toBeGreaterThan(delays[0]!);
    expect(Math.max(...delays)).toBeLessThanOrEqual(30_000);
    expect(t.statuses).toContain('reconnecting');

    t.handshake();
    expect(t.resyncs()).toBe(2); // refetch after the reconnect
  });

  it('jitter spreads reconnects (no synchronized storms) within [ceiling/2, ceiling]', () => {
    const b = { baseMs: 500, maxMs: 30_000 };
    expect(reconnectDelayMs(1, b, () => 0)).toBe(250);
    expect(reconnectDelayMs(1, b, () => 1)).toBe(500);
    expect(reconnectDelayMs(20, b, () => 1)).toBe(30_000);
    expect(new Set(Array.from({ length: 50 }, () => reconnectDelayMs(4, b))).size).toBeGreaterThan(
      10,
    );
  });

  it('delivers events, and stops retrying when authentication or authorization is refused', () => {
    const t = start();
    t.handshake();
    FakeSocket.all[0]!.receive({
      type: 'event',
      event: {
        type: 'task.moved',
        eventId: '2f9e2c1a-1111-4222-8333-944455566677',
        projectId,
        aggregateId: projectId,
        aggregateVersion: 2,
        taskId: projectId,
        actorId: userId,
        correlationId: 'c',
        occurredAt: new Date().toISOString(),
      },
    });
    expect(t.events).toHaveLength(1);

    FakeSocket.all[0]!.drop(4401);
    vi.advanceTimersByTime(120_000);
    expect(FakeSocket.all).toHaveLength(1);
    expect(t.statuses.at(-1)).toBe('offline');

    const f = start();
    FakeSocket.all[0]!.open();
    FakeSocket.all[0]!.receive({ type: 'ready', userId });
    FakeSocket.all[0]!.receive({ type: 'error', code: 'FORBIDDEN', message: 'no', projectId });
    vi.advanceTimersByTime(120_000);
    expect(FakeSocket.all).toHaveLength(1);
    expect(f.statuses.at(-1)).toBe('offline');
  });

  it('stop() ends the connection without reconnecting', () => {
    const t = start();
    t.handshake();
    t.connection.stop();
    vi.advanceTimersByTime(120_000);
    expect(FakeSocket.all).toHaveLength(1);
  });
});
