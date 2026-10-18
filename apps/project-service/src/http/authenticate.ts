import { parseBearerToken, type AuthProvider, type Principal } from '@dpp/auth';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { unauthenticated } from './errors.js';
import type { IdempotentRequest } from './idempotency.js';

declare module 'fastify' {
  interface FastifyRequest {
    principal: Principal | null;
  }
}

export function registerPrincipal(app: FastifyInstance): void {
  app.decorateRequest('principal', null);
}

/**
 * Adds an onRequest hook to the current plugin scope so every route in it requires a valid
 * bearer token. Runs before body validation, so unauthenticated callers learn nothing about
 * request shape.
 */
export function requireAuthentication(app: FastifyInstance, provider: AuthProvider): void {
  app.addHook('onRequest', async (request) => {
    const token = parseBearerToken(request.headers.authorization);
    if (!token) throw unauthenticated();
    request.principal = await provider.authenticate(token);
    request.log = request.log.child({ userId: request.principal.userId });
  });
}

export function principalOf(request: FastifyRequest): Principal {
  if (!request.principal) throw unauthenticated();
  return request.principal;
}

/** Who is acting, and which logical operation (correlation ID) the action belongs to. */
export interface RequestContext {
  principal: Principal;
  /** The request's correlation ID; carried unchanged into every event the request causes. */
  correlationId: string;
  /** Present only on create requests that sent an Idempotency-Key. */
  idempotency?: IdempotentRequest | undefined;
}

export function contextOf(request: FastifyRequest): RequestContext {
  return { principal: principalOf(request), correlationId: request.correlationId };
}
