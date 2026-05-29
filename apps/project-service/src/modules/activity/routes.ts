import type { AuthProvider } from '@dpp/auth';
import { activityPageDto } from '@dpp/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { principalOf, requireAuthentication } from '../../http/authenticate.js';
import { idParams } from '../../http/schemas.js';
import type { ActivityService } from './service.js';

const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  // Cursor: the `id` of the last entry of the previous page (a positive integer).
  before: z
    .string()
    .regex(/^[1-9]\d{0,18}$/, 'must be a cursor from a previous page')
    .optional(),
});

export const activityRoutes: FastifyPluginAsyncZod<{
  service: ActivityService;
  authProvider: AuthProvider;
}> = async (app, { service, authProvider }) => {
  requireAuthentication(app, authProvider);

  app.get(
    '/projects/:id/activity',
    { schema: { params: idParams, querystring: pageQuery, response: { 200: activityPageDto } } },
    (request) => service.list(principalOf(request), request.params.id, request.query),
  );
};
