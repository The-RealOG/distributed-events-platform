import type { AuthProvider } from '@dpp/auth';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { principalOf, requireAuthentication } from '../../http/authenticate.js';
import { idParams } from '../../http/schemas.js';
import { addMemberBody, createWorkspaceBody, memberDto, workspaceDto } from './schemas.js';
import type { WorkspaceService } from './service.js';

export const workspaceRoutes: FastifyPluginAsyncZod<{
  service: WorkspaceService;
  authProvider: AuthProvider;
}> = async (app, { service, authProvider }) => {
  requireAuthentication(app, authProvider);

  app.post(
    '/workspaces',
    { schema: { body: createWorkspaceBody, response: { 201: workspaceDto } } },
    async (request, reply) =>
      reply.code(201).send(await service.create(principalOf(request), request.body.name)),
  );

  app.get('/workspaces', { schema: { response: { 200: z.array(workspaceDto) } } }, (request) =>
    service.list(principalOf(request)),
  );

  app.get(
    '/workspaces/:id',
    { schema: { params: idParams, response: { 200: workspaceDto } } },
    (request) => service.get(principalOf(request), request.params.id),
  );

  app.get(
    '/workspaces/:id/members',
    { schema: { params: idParams, response: { 200: z.array(memberDto) } } },
    (request) => service.listMembers(principalOf(request), request.params.id),
  );

  app.post(
    '/workspaces/:id/members',
    { schema: { params: idParams, body: addMemberBody, response: { 201: memberDto } } },
    async (request, reply) =>
      reply
        .code(201)
        .send(await service.addMember(principalOf(request), request.params.id, request.body)),
  );
};
