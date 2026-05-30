import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Structural rules of Phases 6–7 (ADR-014, ADR-015):
 * - Cache invalidation reaches Redis only through committed events: the Project Service reads
 *   and fills the board cache but never invalidates it (that would be a dual write).
 * - The Activity Service applies events only through the Phase-5 idempotent primitive, under
 *   its fixed logical name.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (['node_modules', 'dist'].includes(name)) return [];
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !name.endsWith('.test.ts') ? [path] : [];
  });
}
const rel = (f: string) => f.slice(root.length + 1);

describe('cache invalidation is event-driven only', () => {
  it('project-service never invalidates or deletes cache entries', () => {
    const offenders = sources(join(root, 'apps/project-service/src')).filter((file) =>
      /\.invalidate\(|\.del\(|\bINCR\b|\bDEL\b/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders.map(rel)).toEqual([]);
  });

  it('the cache is not used by the task write path', () => {
    const offenders = sources(join(root, 'apps/project-service/src/modules/tasks')).filter((file) =>
      /@dpp\/cache|board-cache|BoardCache|SharedCache/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders.map(rel)).toEqual([]);
  });
});

describe('activity-service consumes idempotently under a stable identity', () => {
  const worker = readFileSync(join(root, 'apps/activity-service/src/worker.ts'), 'utf8');

  it('uses createIdempotentHandler and the fixed name as both group and consumer name', () => {
    expect(worker).toMatch(/export const CONSUMER_NAME = 'activity-service';/);
    expect(worker).toMatch(/groupId: CONSUMER_NAME/);
    expect(worker).toMatch(/createIdempotentHandler\(\{[\s\S]*consumerName: CONSUMER_NAME/);
  });

  it('writes activity only inside the idempotent transaction (no other insert path)', () => {
    const writers = sources(join(root, 'apps/activity-service/src')).filter((file) =>
      /insert\(activityEvents\)/.test(readFileSync(file, 'utf8')),
    );
    expect(writers.map(rel)).toEqual(['apps/activity-service/src/projection.ts']);
    expect(readFileSync(join(root, 'apps/activity-service/src/projection.ts'), 'utf8')).toMatch(
      /recordActivity\(tx: DbTransaction/,
    );
  });
});
