import { afterEach, describe, expect, it, vi } from 'vitest';
import { installGracefulShutdown } from './index.js';

const log = { info: vi.fn(), error: vi.fn() };

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('installGracefulShutdown', () => {
  it('marks unready first, runs steps in order, then exits 0 once', async () => {
    const calls: string[] = [];
    const exit = vi.fn();
    const shutdown = installGracefulShutdown({
      log,
      timeoutMs: 1_000,
      signals: [],
      exit,
      onStart: () => calls.push('unready'),
      steps: [
        { name: 'http', run: async () => void calls.push('http') },
        { name: 'db', run: async () => void calls.push('db') },
      ],
    });

    await Promise.all([shutdown('SIGTERM'), shutdown('SIGTERM')]);
    expect(calls).toEqual(['unready', 'http', 'db']);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('keeps closing later dependencies when one step fails, and exits 1', async () => {
    const exit = vi.fn();
    const closedDb = vi.fn();
    const shutdown = installGracefulShutdown({
      log,
      timeoutMs: 1_000,
      signals: [],
      exit,
      steps: [
        { name: 'http', run: () => Promise.reject(new Error('boom')) },
        { name: 'db', run: async () => void closedDb() },
      ],
    });
    await shutdown('SIGTERM');
    expect(closedDb).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('forces exit when a step hangs past the timeout', async () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    const shutdown = installGracefulShutdown({
      log,
      timeoutMs: 500,
      signals: [],
      exit,
      steps: [{ name: 'hung', run: () => new Promise(() => {}) }],
    });
    void shutdown('SIGTERM');
    await vi.advanceTimersByTimeAsync(499);
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(exit).toHaveBeenCalledWith(1);
  });
});
