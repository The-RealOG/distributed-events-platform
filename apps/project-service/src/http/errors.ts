import { AuthenticationError } from '@dpp/auth';
import {
  PG_FOREIGN_KEY_VIOLATION,
  isDatabaseUnavailable,
  isQueryTimeout,
  pgErrorCode,
} from '@dpp/database';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import type { ErrorBody, ErrorCode } from '@dpp/contracts';

/** An error whose status, code and message are safe to return to clients verbatim. */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: Record<string, unknown>) =>
  new AppError(400, 'BAD_REQUEST', message, details);
export const unauthenticated = (message = 'Authentication required') =>
  new AppError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = 'You do not have access to this resource') =>
  new AppError(403, 'FORBIDDEN', message);
export const notFound = (resource: string) =>
  new AppError(404, 'NOT_FOUND', `${resource} not found`);
export const conflict = (message: string) => new AppError(409, 'CONFLICT', message);
export const versionConflict = (currentVersion: number) =>
  new AppError(
    409,
    'VERSION_CONFLICT',
    'The resource was modified by someone else. Refetch and retry.',
    { currentVersion },
  );

function send(reply: FastifyReply, request: FastifyRequest, err: AppError) {
  const body: ErrorBody = {
    error: {
      code: err.code,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
      requestId: request.id,
    },
  };
  return reply.code(err.statusCode).send(body);
}

/**
 * Maps every thrown error to the public error model. Raw database/driver errors and stack
 * traces are logged but never returned.
 */
const OUTCOME_UNKNOWN_MESSAGE =
  'The request timed out. The change may or may not have been applied; refresh before retrying.';

const isSafeMethod = (method: string) => method === 'GET' || method === 'HEAD';

export function registerErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => send(reply, request, notFound('Route')));

  app.setErrorHandler((err: FastifyError, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return send(
        reply,
        request,
        new AppError(400, 'VALIDATION_FAILED', 'Request validation failed', {
          issues: err.validation.map((issue) => ({
            location: err.validationContext,
            path: issue.instancePath,
            message: issue.message,
          })),
        }),
      );
    }
    if (err instanceof AppError) {
      return send(reply, request, err);
    }
    if (err instanceof AuthenticationError) {
      return send(
        reply,
        request,
        err.reason === 'expired'
          ? new AppError(401, 'TOKEN_EXPIRED', 'Token expired')
          : unauthenticated('Invalid token'),
      );
    }
    if (isDatabaseUnavailable(err)) {
      request.log.error({ err }, 'database unavailable');
      return send(
        reply,
        request,
        new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'Service temporarily unavailable'),
      );
    }
    if (isQueryTimeout(err)) {
      request.log.error({ err }, 'database response timed out');
      // A read can simply be retried; a mutation may have committed before the client gave up.
      return send(
        reply,
        request,
        isSafeMethod(request.method)
          ? new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'Service temporarily unavailable')
          : new AppError(504, 'OUTCOME_UNKNOWN', OUTCOME_UNKNOWN_MESSAGE),
      );
    }
    if (pgErrorCode(err) === PG_FOREIGN_KEY_VIOLATION) {
      request.log.warn({ err }, 'foreign key violation');
      return send(reply, request, conflict('A referenced resource no longer exists'));
    }
    // Fastify's own client errors (malformed JSON, oversized body, bad content type).
    if (typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500) {
      return send(
        reply,
        request,
        err.statusCode === 413
          ? new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body too large')
          : new AppError(err.statusCode, 'BAD_REQUEST', 'Malformed request'),
      );
    }

    request.log.error({ err }, 'unhandled error');
    return send(reply, request, new AppError(500, 'INTERNAL', 'Internal server error'));
  });
}
