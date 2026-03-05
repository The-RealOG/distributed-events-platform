import { z } from 'zod';

export { memberDto, workspaceDto, type MemberDto, type WorkspaceDto } from '@dpp/contracts';

export const createWorkspaceBody = z.object({ name: z.string().trim().min(1).max(100) });

export const addMemberBody = z.object({
  email: z.email().max(254),
  role: z.enum(['ADMIN', 'MEMBER']),
});
