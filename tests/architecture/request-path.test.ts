import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The request path reaches Kafka only through the transactional outbox (ADR-011):
 *
 *   request → PostgreSQL transaction (domain change + insertOutboxEvent(tx, …)) → response
 *   outbox-publisher (separate process) → Kafka
 *
 * These guards fail if request-path code depends on Kafka directly (a dual write), touches the
 * publisher's side of the outbox, waits on publication, or writes an outbox row outside the
 * transaction handle of its mutation.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REQUEST_PATH_APPS = ['apps/project-service', 'apps/api-gateway', 'apps/web'];
const KAFKA_MODULES = ['kafkajs', '@dpp/kafka', '@dpp/outbox-publisher'];

// Publisher-side outbox operations and publication state: never in the request path.
const PUBLISHER_ONLY = [
  'claimOutboxBatch',
  'markOutboxPublished',
  'recordOutboxFailure',
  'releaseOutboxClaims',
  'publishedAt',
  'published_at',
  'DomainEventProducer',
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (['node_modules', 'dist'].includes(name)) return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|js|mjs)$/.test(name) ? [path] : [];
  });
}

describe('request path is independent of Kafka', () => {
  it.each(REQUEST_PATH_APPS)('%s declares no Kafka dependency', (app) => {
    const pkg = JSON.parse(readFileSync(join(root, app, 'package.json'), 'utf8')) as Record<
      string,
      Record<string, string> | undefined
    >;
    const deps = { ...pkg['dependencies'], ...pkg['devDependencies'] };
    for (const name of KAFKA_MODULES) expect(Object.keys(deps)).not.toContain(name);
  });

  it.each(REQUEST_PATH_APPS)('%s imports no Kafka module', (app) => {
    const offenders = sourceFiles(join(root, app, 'src')).filter((file) => {
      const text = readFileSync(file, 'utf8');
      return KAFKA_MODULES.some((m) =>
        new RegExp(`from ['"]${m}['"/]|import\\(['"]${m}['"/]`).test(text),
      );
    });
    expect(offenders.map((f) => f.slice(root.length + 1))).toEqual([]);
  });
});

describe('project-service writes events only through the outbox, inside its transaction', () => {
  const files = () => sourceFiles(join(root, 'apps/project-service/src'));

  it('never touches publisher-side outbox operations or publication state', () => {
    const offenders = files().flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      return PUBLISHER_ONLY.filter((name) => text.includes(name)).map(
        (name) => `${file.slice(root.length + 1)}: ${name}`,
      );
    });
    expect(offenders).toEqual([]);
  });

  it('calls insertOutboxEvent only with the transaction handle `tx`', () => {
    const calls = files().flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/insertOutboxEvent\(\s*([\w.]+)/g)].map((m) => ({
        file: file.slice(root.length + 1),
        firstArgument: m[1],
      })),
    );
    expect(calls.length).toBeGreaterThanOrEqual(7); // one per event type
    expect(calls.filter((c) => c.firstArgument !== 'tx')).toEqual([]);
  });
});

describe('Compose: serving requests does not wait for Kafka or the publisher', () => {
  it.each(['project-service', 'api-gateway', 'web'])(
    '%s has no depends_on on kafka, kafka-init or outbox-publisher',
    (service) => {
      const compose = readFileSync(join(root, 'docker-compose.yml'), 'utf8');
      const block =
        new RegExp(`\\n  ${service}:\\n([\\s\\S]*?)(?=\\n  [a-z-]+:\\n|\\nvolumes:)`).exec(
          compose,
        )?.[1] ?? '';
      expect(block).not.toBe('');
      const dependsOn = /depends_on:\n((?: {6}.*\n?)+)/.exec(block)?.[1] ?? '';
      for (const forbidden of ['kafka:', 'kafka-init:', 'outbox-publisher:']) {
        expect(dependsOn).not.toContain(forbidden);
      }
    },
  );
});
