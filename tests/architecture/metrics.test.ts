import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Observability guards (ADR-020): every metric a dashboard queries exists in the code, and no
 * query or metric definition groups by a per-entity label.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dashboardsDir = join(root, 'infrastructure/observability/grafana/dashboards');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (['node_modules', 'dist', 'test'].includes(name)) return [];
    if (statSync(path).isDirectory()) return sources(path);
    return /\.ts$/.test(name) && !name.endsWith('.test.ts') ? [path] : [];
  });
}
const code = [...sources(join(root, 'apps')), ...sources(join(root, 'packages'))]
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');
const defined = new Set(
  [...code.matchAll(/name: '([a-z_]+)'|counter\(\s*'([a-z_]+)'/g)].map((m) => (m[1] ?? m[2])!),
);
// prom-client's default process metrics.
defined.add('process_resident_memory_bytes');

const exprs = readdirSync(dashboardsDir).flatMap((file) => {
  const doc = JSON.parse(readFileSync(join(dashboardsDir, file), 'utf8')) as {
    panels: { targets: { expr: string }[] }[];
  };
  return doc.panels.flatMap((p) => p.targets.map((t) => ({ file, expr: t.expr })));
});

describe('dashboards', () => {
  it('only query metrics that the services define', () => {
    const missing = exprs.flatMap(({ file, expr }) =>
      [...expr.matchAll(/\b([a-z_]+)(?=\{|\[| *\))/g)]
        .map((m) => m[1]!)
        .filter((name) =>
          /_(total|seconds|bytes|events|connections|rooms|requests)(_bucket)?$/.test(name),
        )
        .map((name) => name.replace(/_bucket$/, ''))
        .filter((name) => !defined.has(name))
        .map((name) => `${file}: ${name}`),
    );
    expect(missing).toEqual([]);
  });

  it('never group or filter by per-entity labels', () => {
    for (const { expr } of exprs) {
      expect(expr).not.toMatch(/(project|user|task|workspace|event|request|correlation)_?id/i);
    }
  });
});

describe('metric definitions', () => {
  it('declare no per-entity label names', () => {
    const labelLists = [...code.matchAll(/labelNames: \[([^\]]*)\]/g)].map((m) => m[1]!);
    expect(labelLists.length).toBeGreaterThan(5);
    for (const list of labelLists) {
      expect(list).not.toMatch(
        /(project|user|task|workspace|event|request|correlation)_?id|url|path/i,
      );
    }
  });
});
