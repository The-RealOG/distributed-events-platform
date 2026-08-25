import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Every dashboard query is valid PromQL for the Prometheus version Compose runs. */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dir = join(root, 'infrastructure/observability/grafana/dashboards');
let prometheus: StartedTestContainer;
let base: string;

beforeAll(async () => {
  prometheus = await new GenericContainer('prom/prometheus:v3.15.0')
    .withExposedPorts(9090)
    .withWaitStrategy(Wait.forHttp('/-/ready', 9090))
    .start();
  base = `http://${prometheus.getHost()}:${prometheus.getMappedPort(9090)}`;
}, 120_000);
afterAll(() => prometheus?.stop());

describe('dashboards', () => {
  it('every panel query is accepted by Prometheus', async () => {
    const exprs = readdirSync(dir).flatMap((file) =>
      (
        JSON.parse(readFileSync(join(dir, file), 'utf8')) as {
          panels: { title: string; targets: { expr: string }[] }[];
        }
      ).panels.flatMap((p) =>
        p.targets.map((t) => ({ where: `${file} / ${p.title}`, expr: t.expr })),
      ),
    );
    expect(exprs.length).toBeGreaterThan(20);
    for (const { where, expr } of exprs) {
      const res = await fetch(`${base}/api/v1/query?query=${encodeURIComponent(expr)}`);
      const body = (await res.json()) as { status: string; error?: string };
      expect(body.status, `${where}: ${body.error ?? ''}`).toBe('success');
    }
  });
});
