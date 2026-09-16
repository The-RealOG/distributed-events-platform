import http from 'k6/http';
import { API, RUN_ID } from './config.js';

// 2xx are successes; 409 is an expected optimistic-concurrency conflict (counted separately).
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 299 }, 409));

let seq = 0;
/** One API call, tagged with its operation name (per-endpoint percentiles) and a correlation ID. */
export function call(op, method, path, { token, body, headers = {} } = {}) {
  const params = {
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'x-correlation-id': `load-${RUN_ID}-${__VU}-${++seq}`,
      ...headers,
    },
    tags: { op, name: `${method} ${op}` },
    timeout: '30s',
  };
  const res = http.request(
    method,
    `${API}${path}`,
    body === undefined ? null : JSON.stringify(body),
    params,
  );
  let json;
  try {
    json = res.body ? res.json() : undefined;
  } catch (_) {
    json = undefined;
  }
  return { status: res.status, body: json, res };
}

export function login(name) {
  const r = call('login', 'POST', '/auth/dev-login', {
    body: { email: `${name}@load.example.com`, displayName: name },
  });
  if (r.status !== 200) throw new Error(`login ${name}: HTTP ${r.status}`);
  return { token: r.body.token, id: r.body.user.id, email: r.body.user.email };
}
