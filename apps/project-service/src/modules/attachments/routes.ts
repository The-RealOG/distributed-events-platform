import type { AuthProvider } from '@dpp/auth';
import { attachmentDownloadDto, attachmentDto, attachmentUploadDto } from '@dpp/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { principalOf, requireAuthentication } from '../../http/authenticate.js';
import { idParams } from '../../http/schemas.js';
import type { AttachmentService } from './service.js';

const uploadBody = z.object({
  filename: z.string().min(1).max(1_000),
  contentType: z.string().min(1).max(200),
  sizeBytes: z.number().int().positive(),
});

export const attachmentRoutes: FastifyPluginAsyncZod<{
  service: AttachmentService;
  authProvider: AuthProvider;
}> = async (app, { service, authProvider }) => {
  requireAuthentication(app, authProvider);

  app.post(
    '/tasks/:id/attachments',
    { schema: { params: idParams, body: uploadBody, response: { 201: attachmentUploadDto } } },
    async (request, reply) =>
      reply
        .code(201)
        .send(await service.requestUpload(principalOf(request), request.params.id, request.body)),
  );
  app.get(
    '/tasks/:id/attachments',
    { schema: { params: idParams, response: { 200: z.array(attachmentDto) } } },
    (request) => service.list(principalOf(request), request.params.id),
  );
  app.post(
    '/attachments/:id/complete',
    { schema: { params: idParams, response: { 200: attachmentDto } } },
    (request) => service.complete(principalOf(request), request.params.id),
  );
  app.get(
    '/attachments/:id/download',
    { schema: { params: idParams, response: { 200: attachmentDownloadDto } } },
    (request) => service.download(principalOf(request), request.params.id),
  );
  app.delete('/attachments/:id', { schema: { params: idParams } }, async (request, reply) => {
    await service.delete(principalOf(request), request.params.id);
    return reply.code(204).send();
  });
};
