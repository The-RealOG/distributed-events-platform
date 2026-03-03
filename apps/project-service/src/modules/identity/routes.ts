import type { AuthProvider } from '@dpp/auth';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { principalOf, requireAuthentication } from '../../http/authenticate.js';
import { devLoginResponse, userDto } from '@dpp/contracts';
import type { IdentityService, TokenIssuer } from './service.js';

export const devLoginRoutes: FastifyPluginAsyncZod<{
  service: IdentityService;
  issuer: TokenIssuer;
}> = async (app, { service, issuer }) => {
  app.post(
    '/auth/dev-login',
    {
      schema: {
        body: z.object({
          email: z.email().max(254),
          displayName: z.string().trim().min(1).max(100),
        }),
        response: { 200: devLoginResponse },
      },
    },
    async (request) => service.devLogin(issuer, request.body.email, request.body.displayName),
  );
};

export const identityRoutes: FastifyPluginAsyncZod<{
  service: IdentityService;
  authProvider: AuthProvider;
}> = async (app, { service, authProvider }) => {
  requireAuthentication(app, authProvider);

  app.get('/me', { schema: { response: { 200: userDto } } }, async (request) =>
    service.me(principalOf(request)),
  );
};
