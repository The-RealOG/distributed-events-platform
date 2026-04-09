import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export type LogLine = Record<string, unknown>;

export interface ServiceProcess {
  url: string;
  logs: LogLine[];
  rawOutput: () => string;
  /** Sends SIGTERM and resolves with the exit code and how long shutdown took. */
  stop(): Promise<{ code: number | null; ms: number }>;
}

export async function freePort(): Promise<number> {
  return new Promise((done) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => done(port));
    });
  });
}

/** Runs a built service (`dist/server.js`) as a real process and captures its JSON logs. */
export async function startService(
  app: string,
  env: Record<string, string>,
): Promise<ServiceProcess> {
  const port = await freePort();
  const child: ChildProcess = spawn(process.execPath, ['dist/server.js'], {
    cwd: resolve(repoRoot, 'apps', app),
    env: {
      PATH: process.env['PATH'] ?? '',
      HOST: '127.0.0.1',
      PORT: String(port),
      LOG_LEVEL: 'info',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let raw = '';
  const logs: LogLine[] = [];
  const onData = (chunk: Buffer) => {
    raw += chunk.toString();
    for (const line of chunk.toString().split('\n')) {
      if (!line.trim()) continue;
      try {
        logs.push(JSON.parse(line) as LogLine);
      } catch {
        // non-JSON output is kept in rawOutput for assertions
      }
    }
  };
  child.stdout!.on('data', onData);
  child.stderr!.on('data', onData);

  const url = `http://127.0.0.1:${port}`;
  // Generous: on a loaded machine several suites may be starting containers at once.
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`${app} exited early:\n${raw}`);
    try {
      if ((await fetch(`${url}/ready`)).ok) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error(`${app} did not become ready:\n${raw}`);
    await new Promise((r) => setTimeout(r, 100));
  }

  return {
    url,
    logs,
    rawOutput: () => raw,
    stop: () =>
      new Promise((done) => {
        if (child.exitCode !== null) return done({ code: child.exitCode, ms: 0 });
        const started = Date.now();
        child.once('exit', (code) => done({ code, ms: Date.now() - started }));
        child.kill('SIGTERM');
      }),
  };
}
