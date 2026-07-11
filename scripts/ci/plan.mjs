#!/usr/bin/env node
// Decides which integration shards CI runs (written to $GITHUB_OUTPUT as a job matrix).
//
//   main / manual runs          → every shard (the full distributed-system suite)
//   docs-only change            → none (documentation cannot change behaviour)
//   shared config/tooling change → every shard
//   otherwise                   → shards containing a package whose integration tests are
//                                  affected: the changed package or anything depending on it,
//                                  transitively (Turbo's package graph, not path globs)
//
// Usage: node scripts/ci/plan.mjs <event> <ref> <base-sha>
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

/** Balanced by measured suite time (see docs/ci.md); the slowest shard is the critical path. */
export const SHARDS = {
  kafka: ['@dpp/kafka'],
  system: ['@dpp/system-tests'],
  publisher: ['@dpp/outbox-publisher', '@dpp/cache'],
  consumers: ['@dpp/activity-service', '@dpp/project-service'],
};
const ALL = Object.keys(SHARDS);

const DOCS = /^(docs\/|.*\.md$|LICENSE$|\.editorconfig$)/;
// Inputs every package's tests depend on without Turbo seeing them as a package dependency.
const GLOBAL =
  /^(package\.json|package-lock\.json|turbo\.json|tsconfig\.base\.json|eslint\.config\.js|\.github\/|scripts\/ci\/|docker-compose\.yml|infrastructure\/docker\/)/;

// Every workspace with integration tests must belong to a shard, or CI would silently skip it.
const root = JSON.parse(readFileSync('package.json', 'utf8'));
const withIntegration = root.workspaces
  .flatMap((pattern) =>
    pattern.endsWith('/*')
      ? execFileSync('ls', [pattern.slice(0, -2)], { encoding: 'utf8' })
          .split('\n')
          .filter(Boolean)
          .map((d) => `${pattern.slice(0, -2)}/${d}`)
      : [pattern],
  )
  .map((dir) => {
    try {
      return JSON.parse(readFileSync(`${dir}/package.json`, 'utf8'));
    } catch {
      return undefined;
    }
  })
  .filter((pkg) => pkg?.scripts?.['test:integration'])
  .map((pkg) => pkg.name);
const sharded = new Set(Object.values(SHARDS).flat());
const orphans = withIntegration.filter((name) => !sharded.has(name));
if (orphans.length > 0) {
  console.error(`integration suites not assigned to a CI shard: ${orphans.join(', ')}`);
  process.exit(1);
}

const [event, ref, base] = process.argv.slice(2);
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

function decide() {
  if (event === 'workflow_dispatch' || ref === 'refs/heads/main') {
    return { shards: ALL, reason: 'main or manual run: full suite' };
  }
  if (!base || /^0+$/.test(base)) return { shards: ALL, reason: 'no base commit: full suite' };
  let changed;
  try {
    changed = git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean);
  } catch {
    return { shards: ALL, reason: 'base not in history: full suite' };
  }
  if (changed.length > 0 && changed.every((f) => DOCS.test(f))) {
    return { shards: [], reason: 'documentation only' };
  }
  if (changed.some((f) => GLOBAL.test(f))) return { shards: ALL, reason: 'shared tooling changed' };
  const dry = JSON.parse(
    execFileSync(
      'npx',
      ['--yes', 'turbo@2.11.4', 'run', 'test:integration', `--filter=...[${base}]`, '--dry=json'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    ),
  );
  const affected = new Set(
    dry.tasks
      .filter((t) => t.task === 'test:integration' && t.command && t.command !== '<NONEXISTENT>')
      .map((t) => t.package),
  );
  const shards = ALL.filter((s) => SHARDS[s].some((p) => affected.has(p)));
  return { shards, reason: `affected: ${[...affected].sort().join(', ') || 'none'}` };
}

const { shards, reason } = decide();
console.log(`integration shards: ${JSON.stringify(shards)} (${reason})`);
if (process.env.GITHUB_OUTPUT) {
  const matrix = shards.map((shard) => ({
    shard,
    filters: SHARDS[shard].map((p) => `--filter=${p}`).join(' '),
  }));
  appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(matrix)}\n`);
  appendFileSync(process.env.GITHUB_OUTPUT, `run=${shards.length > 0}\n`);
}
