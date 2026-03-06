import { z } from 'zod';

export { boardDto, projectDto, type BoardDto, type ProjectDto } from '@dpp/contracts';

export const createProjectBody = z.object({
  workspaceId: z.uuid(),
  name: z.string().trim().min(1).max(200),
  description: z.string().max(5_000).default(''),
});
