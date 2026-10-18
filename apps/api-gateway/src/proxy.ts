import { CORRELATION_ID_HEADER } from '@dpp/observability';
import replyFrom from '@fastify/reply-from';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { IncomingHttpHeaders } from 'node:http';
import { sendError } from './errors.js';

/** Public prefix for all proxied API routes; the gateway's own probes live outside it. */
export const API_PREFIX = '/api';

/**
 * Routing table: path prefixes (after /api) owned by the Project Service. Anything else under
 * /api is a 404 at the gateway, so internal endpoints (/health, /ready, future admin routes)
 * are never reachable from the browser by accident.
 */
export const PROJECT_SERVICE_PREFIXES = [
  '/auth/',
  '/me',
  '/workspaces',
  '/projects',
  '/tasks',
  '/attachments',
];

// Request headers forwarded upstream. An allowlist keeps cookies, spoofed forwarding headers
// and per-hop IDs from leaking into internal services.
const FORWARDED_REQUEST_HEADERS = [
  'accept',
  'authorization',
  // Read-your-writes: a client's `no-cache` makes the board read skip the shared cache.
  'cache-control',
  'content-length',
  'content-type',
  // Makes a create request safe to retry; the project service stores and replays its result.
  'idempotency-key',
  'user-agent',
];

// The gateway's own x-request-id identifies this hop; the upstream's is visible in its logs
// and error bodies, and correlation ties the two together.
const DROPPED_RESPONSE_HEADERS = new Set(['x-request-id']);

export interface ProxyOptions {
  upstreamUrl: string;
  connectTimeoutMs: number;
  requestTimeoutMs: number;
  bodyLimit: number;
}

function matchesPrefix(path: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) =>
    prefix.endsWith('/')
      ? path.startsWith(prefix)
      : path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`),
  );
}

function upstreamRequestHeaders(
  request: FastifyRequest,
  incoming: IncomingHttpHeaders,
): IncomingHttpHeaders {
  const headers: IncomingHttpHeaders = {};
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = incoming[name];
    if (value !== undefined) headers[name] = value;
  }
  headers[CORRELATION_ID_HEADER] = request.correlationId;
  headers['x-forwarded-for'] = request.ip;
  return headers;
}

/**
 * - upstream_unreachable: no connection was established, so the request was never sent.
 * - upstream_timeout: the request was sent, but no complete response arrived in time.
 * - upstream_connection_lost: the connection failed after the request may have been sent.
 */
type UpstreamFailure = 'upstream_unreachable' | 'upstream_timeout' | 'upstream_connection_lost';

const NOT_SENT_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
]);

function classifyUpstreamError(err: Error): UpstreamFailure {
  const codes = [
    (err as { code?: string }).code,
    (err.cause as { code?: string } | undefined)?.code,
  ];
  if (codes.some((code) => code !== undefined && NOT_SENT_CODES.has(code))) {
    return 'upstream_unreachable';
  }
  if (
    codes.some((code) => code !== undefined && /TIMEOUT/i.test(code)) ||
    err.name.includes('Timeout')
  ) {
    return 'upstream_timeout';
  }
  return 'upstream_connection_lost';
}

export async function registerProjectServiceProxy(
  app: FastifyInstance,
  options: ProxyOptions,
): Promise<void> {
  await app.register(replyFrom, {
    base: options.upstreamUrl,
    undici: {
      connectTimeout: options.connectTimeoutMs,
      headersTimeout: options.requestTimeoutMs,
      bodyTimeout: options.requestTimeoutMs,
    },
    // Never retry at the gateway. A mutation may have been applied even if its response was
    // lost, and by default reply-from retries GETs on upstream 503 up to 10 times, which would
    // multiply load on a service that is already failing.
    // An empty set disables every retry path, including the 503 one (whose count cannot be
    // set to zero: reply-from treats 0 as "use the default of 10").
    retryMethods: [],
    disableRequestLogging: true,
  });

  // Bodies are forwarded as raw bytes: the gateway enforces size but does not parse or
  // validate JSON; that belongs to the service that owns the endpoint.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer', bodyLimit: options.bodyLimit },
    (_request, body, done) => done(null, body),
  );

  app.route({
    method: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    url: `${API_PREFIX}/*`,
    handler: (request, reply) => {
      const upstreamPath = request.url.slice(API_PREFIX.length);
      if (!matchesPrefix(upstreamPath, PROJECT_SERVICE_PREFIXES)) {
        return sendError(request, reply, 404, 'NOT_FOUND', 'Route not found');
      }

      const startedAt = performance.now();
      // Hand the raw bytes over explicitly: given a Buffer as the parsed body, reply-from
      // would JSON.stringify it into {"type":"Buffer","data":[...]}.
      const rawBody = Buffer.isBuffer(request.body) ? request.body : undefined;
      return reply.from(upstreamPath, {
        ...(rawBody
          ? { body: rawBody, contentType: request.headers['content-type'] ?? 'application/json' }
          : {}),
        rewriteRequestHeaders: (_req, incoming) => upstreamRequestHeaders(request, incoming),
        rewriteHeaders: (headers) =>
          Object.fromEntries(
            Object.entries(headers).filter(([name]) => !DROPPED_RESPONSE_HEADERS.has(name)),
          ),
        onError: (_errorReply, { error }) => {
          const reason = classifyUpstreamError(error);
          // Internal detail (upstream URL, socket error) stays in logs only.
          request.log.error(
            {
              err: error,
              upstream: 'project-service',
              reason,
              elapsedMs: Math.round(performance.now() - startedAt),
            },
            'upstream request failed',
          );
          // Once a mutation may have reached the Project Service, the gateway cannot tell whether
          // it committed: only "never sent" is a confirmed failure. A read never changes state.
          const outcomeUnknown =
            reason !== 'upstream_unreachable' &&
            request.method !== 'GET' &&
            request.method !== 'HEAD';
          void sendError(
            request,
            reply,
            outcomeUnknown ? 504 : 503,
            outcomeUnknown ? 'OUTCOME_UNKNOWN' : 'DEPENDENCY_UNAVAILABLE',
            outcomeUnknown
              ? 'The service did not respond in time. The change may or may not have been applied; refresh before retrying.'
              : 'Service temporarily unavailable',
            { reason },
          );
        },
      });
    },
  });
}
