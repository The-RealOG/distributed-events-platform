import type { ErrorBody, ErrorCode } from '@dpp/contracts';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export function sendError(
  request: FastifyRequest,
  reply: FastifyReply,
  statusCode: number,
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
) {
  const body: ErrorBody = {
    error: { code, message, ...(details ? { details } : {}), requestId: request.id },
  };
  return reply.code(statusCode).type('application/json').send(body);
}

/** Errors the gateway itself originates. Upstream error responses are passed through as-is. */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) =>
    sendError(request, reply, 404, 'NOT_FOUND', 'Route not found'),
  );

  app.setErrorHandler((err: FastifyError, request, reply) => {
    if (err.statusCode === 429) {
      return sendError(request, reply, 429, 'RATE_LIMITED', err.message);
    }
    if (err.statusCode === 413) {
      return sendError(request, reply, 413, 'PAYLOAD_TOO_LARGE', 'Request body too large');
    }
    if (typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500) {
      return sendError(request, reply, err.statusCode, 'BAD_REQUEST', 'Malformed request');
    }
    request.log.error({ err }, 'unhandled gateway error');
    return sendError(request, reply, 500, 'INTERNAL', 'Internal server error');
  });
}
