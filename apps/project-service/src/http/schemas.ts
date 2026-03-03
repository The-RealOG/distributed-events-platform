import { z } from 'zod';

export { userDto, workspaceRoleSchema, type UserDto } from '@dpp/contracts';

export const idParams = z.object({ id: z.uuid() });

export const iso = (date: Date): string => date.toISOString();
