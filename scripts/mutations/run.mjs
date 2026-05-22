#!/usr/bin/env node
// Applies one deliberate break, rebuilds, runs its tests, restores the files.
// Exit 0 when the outcome is as expected (tests fail; baseline: tests pass), 1 otherwise.
//   node scripts/mutations/run.mjs <id>      node scripts/mutations/run.mjs --list [phase]
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { mutations } from './mutations.mjs';

const [arg, phase] = process.argv.slice(2);
if (arg === '--list') {
  const ids = mutations
    .filter((m) => !phase || String(m.phase) === phase || m.id.startsWith(phase))
    .map((m) => m.id);
  console.log(JSON.stringify(ids));
  process.exit(0);
}
const m = mutations.find((x) => x.id === arg);
if (!m) {
  console.error(`unknown mutation ${arg}`);
  process.exit(2);
}

const originals = new Map();
const restore = () => {
  for (const [file, text] of originals) writeFileSync(file, text);
};
const run = (cmd, args, cwd = '.') =>
  spawnSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, FORCE_COLOR: '0' } }).status;

try {
  for (const { file, find, replace } of m.edits) {
    const text = originals.get(file) ?? readFileSync(file, 'utf8');
    if (!originals.has(file)) originals.set(file, text);
    const current = readFileSync(file, 'utf8');
    const count = current.split(find).length - 1;
    if (count !== 1)
      throw new Error(`${m.id}: expected 1 match in ${file}, found ${count}: ${find}`);
    writeFileSync(
      file,
      current.replace(find, () => replace),
    );
  }
  console.log(`\n=== ${m.id}: ${m.title}`);
  // The break must compile: a build failure would "kill" it without testing anything.
  if (run('npm', ['run', 'build', '--', '--output-logs=errors-only']) !== 0) {
    throw new Error(`${m.id}: build failed with the mutation applied (fix the entry)`);
  }
  let failed = false;
  for (const t of m.tests) {
    const args = ['vitest', 'run', '--config', t.config, ...t.files];
    if (t.name) args.push('-t', t.name);
    console.log(`\n--- ${t.cwd}: npx ${args.join(' ')}`);
    if (run('npx', args, t.cwd) !== 0) failed = true;
  }
  const expected = (m.expect ?? 'fail') === 'fail';
  const ok = failed === expected;
  console.log(
    `\n=== RESULT ${m.id}: tests ${failed ? 'FAILED' : 'PASSED'} → ${
      m.expect === 'pass' ? 'baseline' : failed ? 'CAUGHT' : 'SURVIVED'
    } (${ok ? 'as expected' : 'UNEXPECTED'})`,
  );
  process.exitCode = ok ? 0 : 1;
} catch (err) {
  console.error(String(err));
  process.exitCode = 3;
} finally {
  restore();
}
