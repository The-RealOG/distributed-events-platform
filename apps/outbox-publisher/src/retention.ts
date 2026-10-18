import { prunePublishedOutboxEvents, type Database } from '@dpp/database';
import type { Logger } from 'pino';

export interface OutboxRetentionOptions {
  db: Database;
  logger: Logger;
  /** Published events older than this are deleted. Keep it at least as long as Kafka's retention. */
  olderThanHours: number;
  intervalMs: number;
  /** Rows per DELETE, so a large backlog never becomes one long-running statement. */
  batchSize?: number;
}

/**
 * Deletes published outbox rows past the retention, periodically and in bounded batches. Pending
 * rows are never deleted (see prunePublishedOutboxEvents). Failures are logged and retried on the
 * next interval: retention is housekeeping, and publishing never depends on it.
 */
export class OutboxRetention {
  readonly #o: Required<OutboxRetentionOptions>;
  #timer: NodeJS.Timeout | undefined;
  #running: Promise<number> | undefined;
  #stopping = false;

  constructor(options: OutboxRetentionOptions) {
    this.#o = { batchSize: 1_000, ...options };
  }

  start(): void {
    this.#timer = setInterval(() => void this.runOnce(), this.#o.intervalMs);
    this.#timer.unref();
  }

  /** One pass: batches until fewer than `batchSize` rows qualify. Returns the number deleted. */
  runOnce(): Promise<number> {
    this.#running ??= this.#prune().finally(() => {
      this.#running = undefined;
    });
    return this.#running;
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    clearInterval(this.#timer);
    await this.#running;
  }

  async #prune(): Promise<number> {
    let deleted = 0;
    try {
      for (;;) {
        const n = await prunePublishedOutboxEvents(this.#o.db, {
          olderThanHours: this.#o.olderThanHours,
          limit: this.#o.batchSize,
        });
        deleted += n;
        if (n < this.#o.batchSize || this.#stopping) break;
      }
      if (deleted > 0) this.#o.logger.info({ deleted }, 'pruned published outbox events');
    } catch (err) {
      this.#o.logger.warn({ err, deleted }, 'outbox retention failed; will retry');
    }
    return deleted;
  }
}
