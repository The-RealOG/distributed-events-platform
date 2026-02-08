import { randomUUID } from 'node:crypto';
import {
  LogController,
  type FastifyInstance,
  type FastifyServerOptions,
  type RawRequestDefaultExpression,
} from 'fastify';

export const REQUEST_ID_HEADER = 'x-request-id';
export const CORRELATION_ID_HEADER = 'x-correlation-id';

// Inbound IDs are echoed into logs, headers and (later) Kafka events, so only accept
// short opaque tokens; anything else is replaced rather than trusted.
const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function acceptIncomingId(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' && SAFE_ID.test(value) ? value : undefined;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Spans a whole causal chain (client → services → events); defaults to the request ID. */
    correlationId: string;
  }
}

/**
 * Fastify constructor options that make `request.id` a validated or generated request ID.
 * Built-in request logging is disabled because it logs through the logger bound at request
 * creation, before correlation and user IDs are known; `registerRequestContext` logs instead.
 */
export function requestIdOptions(): Pick<
  FastifyServerOptions,
  'genReqId' | 'requestIdHeader' | 'logController'
> {
  return {
    logController: new LogController({
      disableRequestLogging: true,
      requestIdLogLabel: 'requestId',
    }),
    requestIdHeader: false,
    genReqId: (req: RawRequestDefaultExpression) =>
      acceptIncomingId(req.headers[REQUEST_ID_HEADER]) ?? randomUUID(),
  };
}

const PROBE_PATHS = new Set(['/health', '/ready', '/metrics']);

/**
 * Attaches the correlation ID to the request, its logger, and the response headers, and logs
 * one line per completed request with every identifier added along the way (e.g. userId).
 */
export function registerRequestContext(app: FastifyInstance): void {
  app.decorateRequest('correlationId', '');
  app.addHook('onRequest', async (request, reply) => {
    request.correlationId = acceptIncomingId(request.headers[CORRELATION_ID_HEADER]) ?? request.id;
    request.log = request.log.child({ correlationId: request.correlationId });
    void reply.header(REQUEST_ID_HEADER, request.id);
    void reply.header(CORRELATION_ID_HEADER, request.correlationId);
  });

  app.addHook('onResponse', async (request, reply) => {
    const fields = {
      method: request.method,
      // The route template (e.g. /tasks/:id) rather than the raw URL keeps logs groupable.
      route: request.routeOptions.url ?? 'unmatched',
      statusCode: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime * 100) / 100,
    };
    if (PROBE_PATHS.has(request.url)) request.log.debug(fields, 'request completed');
    else request.log.info(fields, 'request completed');
  });
}
