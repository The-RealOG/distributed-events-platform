// Runs INSIDE a service container (via scripts/aws/cpu-profile.sh). Opens the Node inspector of
// the service process on 127.0.0.1 (SIGUSR1; never reachable from outside the task), samples a
// CPU profile for N seconds over the DevTools protocol, and prints a compact self-time summary
// (top functions and top packages). The service keeps serving throughout.
import { readdirSync, readFileSync } from 'node:fs';

const seconds = Number(process.argv[2] ?? 20);
const pid = readdirSync('/proc')
  .filter((d) => /^\d+$/.test(d) && Number(d) !== process.pid)
  .find((d) => {
    try {
      return readFileSync(`/proc/${d}/cmdline`, 'utf8').includes('dist/server.js');
    } catch {
      return false;
    }
  });
if (!pid) throw new Error('service process not found');
process.kill(Number(pid), 'SIGUSR1');
await new Promise((r) => setTimeout(r, 1500));
const [target] = await (await fetch('http://127.0.0.1:9229/json/list')).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg.result);
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    pending.set(++id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
await send('Profiler.enable');
await send('Profiler.setSamplingInterval', { interval: 1000 });
await send('Profiler.start');
await new Promise((r) => setTimeout(r, seconds * 1000));
const { profile } = await send('Profiler.stop');
await send('Profiler.disable');
ws.close();

const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
for (const s of profile.samples) self.set(s, (self.get(s) ?? 0) + 1);
const total = profile.samples.length;
const fn = new Map();
const pkg = new Map();
for (const [nodeId, count] of self) {
  const { functionName, url, lineNumber } = byId.get(nodeId).callFrame;
  const short = url.replace(/^file:\/\/\/app\//, '').replace(/.*node_modules\//, 'nm/');
  const key = `${functionName || '(anonymous)'} ${short}${url ? `:${lineNumber + 1}` : ''}`;
  fn.set(key, (fn.get(key) ?? 0) + count);
  const p = !url
    ? functionName.startsWith('(')
      ? functionName
      : '(native)'
    : (/node_modules\/((@[^/]+\/)?[^/]+)/.exec(url)?.[1] ??
      (url.startsWith('node:') ? 'node:core' : 'app'));
  pkg.set(p, (pkg.get(p) ?? 0) + count);
}
const pct = (n) => `${((100 * n) / total).toFixed(1).padStart(5)} %`;
console.log(`samples ${total} over ${seconds} s (1 ms interval)`);
console.log('--- self time by package');
for (const [k, v] of [...pkg].sort((a, b) => b[1] - a[1]).slice(0, 14))
  console.log(`${pct(v)}  ${k}`);
console.log('--- top functions (self time)');
for (const [k, v] of [...fn].sort((a, b) => b[1] - a[1]).slice(0, 22))
  console.log(`${pct(v)}  ${k.slice(0, 110)}`);
