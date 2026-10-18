import type { AuthProvider } from '@dpp/auth';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { contextOf, principalOf, requireAuthentication } from '../../http/authenticate.js';
import { idempotencyOf } from '../../http/idempotency.js';
import { idParams } from '../../http/schemas.js';
import {
  assignBody,
  assigneeParams,
  commentDto,
  createCommentBody,
  createTaskBody,
  deleteTaskQuery,
  moveTaskBody,
  taskDto,
  updateTaskBody,
} from './schemas.js';
import type { TaskService } from './service.js';

export const taskRoutes: FastifyPluginAsyncZod<{
  service: TaskService;
  authProvider: AuthProvider;
}> = async (app, { service, authProvider }) => {
  requireAuthentication(app, authProvider);

  app.post(
    '/tasks',
    { schema: { body: createTaskBody, response: { 201: taskDto } } },
    async (request, reply) =>
      reply
        .code(201)
        .send(
          await service.create(
            { ...contextOf(request), idempotency: idempotencyOf(request) },
            request.body,
          ),
        ),
  );

  app.get('/tasks/:id', { schema: { params: idParams, response: { 200: taskDto } } }, (request) =>
    service.get(principalOf(request), request.params.id),
  );

  app.patch(
    '/tasks/:id',
    { schema: { params: idParams, body: updateTaskBody, response: { 200: taskDto } } },
    (request) => service.update(contextOf(request), request.params.id, request.body),
  );

  app.delete(
    '/tasks/:id',
    { schema: { params: idParams, querystring: deleteTaskQuery } },
    async (request, reply) => {
      await service.delete(contextOf(request), request.params.id, request.query.expectedVersion);
      return reply.code(204).send();
    },
  );

  app.post(
    '/tasks/:id/move',
    { schema: { params: idParams, body: moveTaskBody, response: { 200: taskDto } } },
    (request) => service.move(contextOf(request), request.params.id, request.body),
  );

  app.post(
    '/tasks/:id/assignees',
    { schema: { params: idParams, body: assignBody, response: { 200: taskDto } } },
    (request) => service.assign(contextOf(request), request.params.id, request.body.userId),
  );

  app.delete(
    '/tasks/:id/assignees/:userId',
    { schema: { params: assigneeParams } },
    async (request, reply) => {
      await service.unassign(contextOf(request), request.params.id, request.params.userId);
      return reply.code(204).send();
    },
  );

  app.get(
    '/tasks/:id/comments',
    { schema: { params: idParams, response: { 200: z.array(commentDto) } } },
    (request) => service.listComments(principalOf(request), request.params.id),
  );

  app.post(
    '/tasks/:id/comments',
    { schema: { params: idParams, body: createCommentBody, response: { 201: commentDto } } },
    async (request, reply) =>
      reply
        .code(201)
        .send(
          await service.addComment(
            { ...contextOf(request), idempotency: idempotencyOf(request) },
            request.params.id,
            request.body.body,
          ),
        ),
  );
};
