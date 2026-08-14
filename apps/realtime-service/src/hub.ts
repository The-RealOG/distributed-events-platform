import { REALTIME_CLOSE, type RealtimeEnvelope, type RealtimeServerMessage } from '@dpp/contracts';
import type { Logger } from 'pino';
import type { WebSocket } from 'ws';

export interface Client {
  readonly socket: WebSocket;
  userId?: string;
  readonly projects: Set<string>;
  alive: boolean;
}

export interface HubOptions {
  logger: Logger;
  /** A client whose unsent data exceeds this is disconnected (it reconnects and refetches). */
  maxBufferedBytes: number;
  /** Ping interval; a client that misses one full interval is terminated. */
  heartbeatMs: number;
  /** Remembered event IDs for suppressing duplicate broadcasts (bounded). */
  recentEvents?: number;
}

export interface HubCounters {
  broadcast: number;
  sendFailures: number;
  slowClientDisconnects: number;
  heartbeatTerminations: number;
  duplicatesSuppressed: number;
}

/**
 * Connection membership for ONE replica: projectId → local sockets (ADR-016). Holds no domain
 * state. Every structure is bounded or cleaned up on disconnect: rooms are deleted when empty,
 * the duplicate window is a fixed-size ring, and slow or dead sockets are closed.
 */
export class Hub {
  readonly #clients = new Set<Client>();
  readonly #rooms = new Map<string, Set<Client>>();
  readonly #recent: string[] = [];
  readonly #recentSet = new Set<string>();
  readonly #options: HubOptions;
  #heartbeat: NodeJS.Timeout | undefined;
  readonly counters: HubCounters = {
    broadcast: 0,
    sendFailures: 0,
    slowClientDisconnects: 0,
    heartbeatTerminations: 0,
    duplicatesSuppressed: 0,
  };

  constructor(options: HubOptions) {
    this.#options = options;
  }

  get connections(): number {
    return this.#clients.size;
  }

  get rooms(): number {
    return this.#rooms.size;
  }

  /** Local members of a project's room (tests and diagnostics). */
  membersOf(projectId: string): number {
    return this.#rooms.get(projectId)?.size ?? 0;
  }

  add(socket: WebSocket): Client {
    const client: Client = { socket, projects: new Set(), alive: true };
    this.#clients.add(client);
    socket.on('pong', () => {
      client.alive = true;
    });
    return client;
  }

  remove(client: Client): void {
    if (!this.#clients.delete(client)) return;
    for (const projectId of client.projects) {
      const room = this.#rooms.get(projectId);
      room?.delete(client);
      if (room?.size === 0) this.#rooms.delete(projectId);
    }
    client.projects.clear();
  }

  join(client: Client, projectId: string): void {
    if (!this.#clients.has(client)) return;
    client.projects.add(projectId);
    let room = this.#rooms.get(projectId);
    if (!room) this.#rooms.set(projectId, (room = new Set()));
    room.add(client);
  }

  leave(client: Client, projectId: string): void {
    client.projects.delete(projectId);
    const room = this.#rooms.get(projectId);
    room?.delete(client);
    if (room?.size === 0) this.#rooms.delete(projectId);
  }

  /** Sends to the project's local room only. Returns the number of sockets written to. */
  broadcast(envelope: RealtimeEnvelope): number {
    // At-least-once delivery from Kafka: the same event can arrive twice. Suppress what we have
    // just sent (bounded window); anything older is harmless anyway (clients refetch).
    if (this.#recentSet.has(envelope.eventId)) {
      this.counters.duplicatesSuppressed++;
      return 0;
    }
    this.#remember(envelope.eventId);
    const room = this.#rooms.get(envelope.projectId);
    if (!room) return 0;
    const data = JSON.stringify({ type: 'event', event: envelope } satisfies RealtimeServerMessage);
    let sent = 0;
    for (const client of [...room]) {
      if (client.socket.readyState !== client.socket.OPEN) continue;
      if (client.socket.bufferedAmount > this.#options.maxBufferedBytes) {
        // Never queue without bound for a client that is not reading.
        this.counters.slowClientDisconnects++;
        this.#options.logger.warn(
          { userId: client.userId, bufferedBytes: client.socket.bufferedAmount },
          'slow realtime client disconnected',
        );
        client.socket.close(REALTIME_CLOSE.slowClient, 'too slow; reconnect and refetch');
        this.remove(client);
        continue;
      }
      try {
        client.socket.send(data);
        sent++;
      } catch {
        this.counters.sendFailures++;
      }
    }
    this.counters.broadcast += sent;
    return sent;
  }

  #remember(eventId: string): void {
    const max = this.#options.recentEvents ?? 1024;
    this.#recent.push(eventId);
    this.#recentSet.add(eventId);
    while (this.#recent.length > max) this.#recentSet.delete(this.#recent.shift()!);
  }

  startHeartbeat(): void {
    this.#heartbeat ??= setInterval(() => {
      for (const client of [...this.#clients]) {
        if (!client.alive) {
          this.counters.heartbeatTerminations++;
          client.socket.terminate();
          this.remove(client);
          continue;
        }
        client.alive = false;
        try {
          client.socket.ping();
        } catch {
          // a socket failing to ping will fail the next round and be terminated
        }
      }
    }, this.#options.heartbeatMs);
    this.#heartbeat.unref();
  }

  /** Graceful shutdown: tell every client to reconnect (to another replica) and forget them. */
  closeAll(code: number, reason: string): void {
    if (this.#heartbeat) clearInterval(this.#heartbeat);
    this.#heartbeat = undefined;
    for (const client of [...this.#clients]) {
      client.socket.close(code, reason);
      this.remove(client);
    }
  }
}
