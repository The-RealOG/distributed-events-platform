import {
  REALTIME_CLOSE,
  realtimeServerMessage,
  type RealtimeClientMessage,
  type RealtimeEnvelope,
} from '@dpp/contracts';

export type RealtimeStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';

export interface RealtimeConnectionOptions {
  url: string;
  projectId: string;
  getToken: () => string | null;
  onEvent: (event: RealtimeEnvelope) => void;
  /** Subscribed (first time or after a reconnect): events may have been missed, so refetch. */
  onResync: () => void;
  onStatus: (status: RealtimeStatus) => void;
  WebSocketImpl?: typeof WebSocket;
  backoff?: { baseMs: number; maxMs: number };
  random?: () => number;
}

/** Equal-jitter exponential backoff: uniform in [ceiling/2, ceiling], ceiling ≤ maxMs. */
export function reconnectDelayMs(
  attempt: number,
  backoff: { baseMs: number; maxMs: number },
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(
    backoff.maxMs,
    backoff.baseMs * 2 ** Math.min(Math.max(attempt - 1, 0), 20),
  );
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

/**
 * One project's realtime subscription (ADR-016). Notifications only: the caller refetches over
 * HTTP, so missed or duplicated messages cannot leave the UI wrong. Reconnects with bounded,
 * jittered backoff (no tight loop, no synchronized reconnect storms), and reports every
 * successful (re)subscription so the caller reconciles.
 */
export class RealtimeConnection {
  #socket: WebSocket | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #attempt = 0;
  #stopped = false;
  readonly #o: RealtimeConnectionOptions;

  constructor(options: RealtimeConnectionOptions) {
    this.#o = options;
  }

  start(): void {
    this.#stopped = false;
    this.#connect();
  }

  stop(): void {
    this.#stopped = true;
    clearTimeout(this.#timer);
    this.#socket?.close(1000, 'leaving');
    this.#socket = undefined;
  }

  #connect(): void {
    const token = this.#o.getToken();
    if (!token) return this.#o.onStatus('offline');
    this.#o.onStatus(this.#attempt === 0 ? 'connecting' : 'reconnecting');
    const Impl = this.#o.WebSocketImpl ?? WebSocket;
    const socket = new Impl(this.#o.url);
    this.#socket = socket;
    const send = (message: RealtimeClientMessage) => socket.send(JSON.stringify(message));
    let permanent = false;

    socket.onopen = () => send({ type: 'auth', token });
    socket.onmessage = (message: MessageEvent<string>) => {
      let parsed;
      try {
        parsed = realtimeServerMessage.safeParse(JSON.parse(message.data));
      } catch {
        return;
      }
      if (!parsed.success) return;
      const m = parsed.data;
      if (m.type === 'ready') send({ type: 'subscribe', projectId: this.#o.projectId });
      else if (m.type === 'subscribed') {
        this.#attempt = 0;
        this.#o.onStatus('live');
        this.#o.onResync();
      } else if (m.type === 'event') this.#o.onEvent(m.event);
      else if (m.type === 'error' && (m.code === 'FORBIDDEN' || m.code === 'NOT_FOUND')) {
        permanent = true; // retrying cannot help
        socket.close(1000, 'not allowed');
      }
    };
    socket.onclose = (event: CloseEvent) => {
      if (this.#socket !== socket || this.#stopped) return;
      if (permanent || event.code === REALTIME_CLOSE.unauthenticated) {
        this.#o.onStatus('offline');
        return;
      }
      this.#attempt++;
      this.#o.onStatus('reconnecting');
      const delay = reconnectDelayMs(
        this.#attempt,
        this.#o.backoff ?? { baseMs: 500, maxMs: 30_000 },
        this.#o.random,
      );
      this.#timer = setTimeout(() => this.#connect(), delay);
    };
  }
}
