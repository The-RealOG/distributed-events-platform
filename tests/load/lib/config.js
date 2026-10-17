// Load-test parameters (all from the environment; nothing about any deployment is hard-coded).
const env = (name, fallback) =>
  __ENV[name] === undefined || __ENV[name] === '' ? fallback : __ENV[name];
const int = (name, fallback) => parseInt(env(name, String(fallback)), 10);

export const BASE_URL = env('BASE_URL', 'http://localhost:8080').replace(/\/$/, '');
export const API = `${BASE_URL}/api`;
export const SCENARIO = env('SCENARIO', 'balanced');

/**
 * Operation mixes (weights, %). Reads and writes are the operations a project-management user
 * performs; the weights below are the whole definition of each scenario.
 */
export const MIXES = {
  // Board/project reads only: what the shared cache serves.
  'read-heavy': { board: 80, task: 5, activity: 5, projects: 5, workspaces: 5 },
  // Representative: 70 % reads, 30 % writes.
  balanced: {
    board: 35,
    task: 10,
    activity: 10,
    projects: 10,
    workspaces: 5,
    create: 7,
    update: 7,
    move: 7,
    assign: 3,
    unassign: 2,
    comment: 3,
    delete: 1,
  },
  // PostgreSQL/outbox/Kafka pressure: 20 % reads, 80 % writes.
  'write-heavy': {
    board: 10,
    task: 5,
    activity: 5,
    create: 15,
    update: 20,
    move: 20,
    assign: 8,
    unassign: 5,
    comment: 10,
    delete: 2,
  },
};
MIXES['hot-project'] = MIXES.balanced;
MIXES['multi-project'] = MIXES.balanced;

export const READ_OPS = ['board', 'task', 'activity', 'projects', 'workspaces'];
export const WRITE_OPS = ['create', 'update', 'move', 'assign', 'unassign', 'comment', 'delete'];

/** READ_WRITE_RATIO (e.g. 0.7) rescales a scenario's reads and writes to that share. */
export function mixFor(scenario) {
  const base = MIXES[scenario];
  if (!base)
    throw new Error(`unknown SCENARIO ${scenario}; one of ${Object.keys(MIXES).join(', ')}`);
  const ratio = env('READ_WRITE_RATIO', '');
  if (ratio === '') return base;
  const r = parseFloat(ratio);
  const reads = READ_OPS.filter((o) => base[o]);
  const writes = WRITE_OPS.filter((o) => base[o]);
  const sum = (ops, src) => ops.reduce((s, o) => s + (src[o] || 0), 0);
  const writeSrc = writes.length ? base : MIXES.balanced;
  const writeOps = writes.length ? writes : WRITE_OPS;
  const out = {};
  for (const o of reads) out[o] = (base[o] / sum(reads, base)) * r * 100;
  for (const o of writeOps) out[o] = (writeSrc[o] / sum(writeOps, writeSrc)) * (1 - r) * 100;
  return out;
}

export const VUS = int('VUS', 10);
export const DURATION = env('DURATION', '5m');
export const RAMP = env('RAMP', '30s');
export const TEST_USER_COUNT = int('TEST_USER_COUNT', 20);
export const WORKSPACE_COUNT = int('WORKSPACE_COUNT', 5);
export const PROJECT_COUNT = SCENARIO === 'hot-project' ? 1 : int('PROJECT_COUNT', 20);
export const SEED_TASKS = int('SEED_TASKS', 20);
/** Pause between one user's operations (ms, uniform 0..2×). 0 = closed loop at full speed. */
export const THINK_MS = int('THINK_MS', 500);
/** A VU keeps at most this many of its own tasks; beyond it, creates become deletes. */
export const MAX_OWN_TASKS = int('MAX_OWN_TASKS', 15);
/** Browser-realistic request header (CloudFront → ALB → gateway accept any). */
export const RUN_ID = env('RUN_ID', `${SCENARIO}-${Date.now()}`);
