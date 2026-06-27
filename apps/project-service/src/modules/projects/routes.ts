import type { AuthProvider } from '@dpp/auth';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { principalOf, requireAuthentication } from '../../http/authenticate.js';
import { idParams } from '../../http/schemas.js';
import { boardDto, createProjectBody, projectDto } from './schemas.js';
import type { ProjectService } from './service.js';

export const projectRoutes: FastifyPluginAsyncZod<{
  service: ProjectService;
  authProvider: AuthProvider;
}> = async (app, { service, authProvider }) => {
  requireAuthentication(app, authProvider);

  app.post(
    '/projects',
    { schema: { body: createProjectBody, response: { 201: projectDto } } },
    async (request, reply) =>
      reply.code(201).send(await service.create(principalOf(request), request.body)),
  );

  app.get(
    '/workspaces/:id/projects',
    { schema: { params: idParams, response: { 200: z.array(projectDto) } } },
    (request) => service.listInWorkspace(principalOf(request), request.params.id),
  );

  app.get(
    '/projects/:id',
    { schema: { params: idParams, response: { 200: projectDto } } },
    (request) => service.get(principalOf(request), request.params.id),
  );

  app.get(
    '/projects/:id/board',
    { schema: { params: idParams, response: { 200: boardDto } } },
    async (request, reply) => {
      const fresh = /\bno-cache\b/.test(request.headers['cache-control'] ?? '');
      const { board, cache } = await service.getBoardCached(
        principalOf(request),
        request.params.id,
        {
          fresh,
        },
      );
      // Diagnostic only, like a CDN's X-Cache (named apart: CloudFront overwrites X-Cache): HIT,
      // MISS, REFRESH (client asked for fresh
      // data: read your own writes), or BYPASS (cache off/unavailable).
      void reply.header('x-board-cache', cache);
      return board;
    },
  );
};
