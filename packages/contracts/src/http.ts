import { z } from 'zod';

/**
 * Public HTTP contract of the platform, shared by services (response serialization), the
 * gateway (error responses it originates) and the browser (runtime-checked parsing).
 * Request-body validation stays with the owning service.
 */

export const errorCodeSchema = z.enum([
  'VALIDATION_FAILED',
  'BAD_REQUEST',
  'UNAUTHENTICATED',
  'TOKEN_EXPIRED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VERSION_CONFLICT',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'DEPENDENCY_UNAVAILABLE',
  'INTERNAL',
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const errorBodySchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
    requestId: z.string(),
  }),
});
export type ErrorBody = z.infer<typeof errorBodySchema>;

export const workspaceRoleSchema = z.enum(['OWNER', 'ADMIN', 'MEMBER']);
export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;

export const userDto = z.object({
  id: z.uuid(),
  email: z.email(),
  displayName: z.string(),
});
export type UserDto = z.infer<typeof userDto>;

export const devLoginResponse = z.object({ token: z.string(), user: userDto });
export type DevLoginResponse = z.infer<typeof devLoginResponse>;

export const workspaceDto = z.object({
  id: z.uuid(),
  name: z.string(),
  createdBy: z.uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
  role: workspaceRoleSchema,
});
export type WorkspaceDto = z.infer<typeof workspaceDto>;

export const memberDto = z.object({
  userId: z.uuid(),
  email: z.string(),
  displayName: z.string(),
  role: workspaceRoleSchema,
  joinedAt: z.string(),
});
export type MemberDto = z.infer<typeof memberDto>;

export const projectDto = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  name: z.string(),
  description: z.string(),
  createdBy: z.uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProjectDto = z.infer<typeof projectDto>;

export const taskDto = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  columnId: z.uuid(),
  title: z.string(),
  description: z.string(),
  // NUMERIC is returned as a decimal string to avoid float precision loss.
  position: z.string(),
  version: z.number().int(),
  createdBy: z.uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
  assigneeIds: z.array(z.uuid()),
});
export type TaskDto = z.infer<typeof taskDto>;

export const commentDto = z.object({
  id: z.uuid(),
  taskId: z.uuid(),
  authorId: z.uuid(),
  authorDisplayName: z.string(),
  body: z.string(),
  createdAt: z.string(),
});
export type CommentDto = z.infer<typeof commentDto>;

export const boardColumnDto = z.object({
  id: z.uuid(),
  name: z.string(),
  position: z.string(),
  tasks: z.array(taskDto),
});
export type BoardColumnDto = z.infer<typeof boardColumnDto>;

export const boardDto = z.object({
  project: projectDto,
  board: z.object({ id: z.uuid(), name: z.string() }),
  columns: z.array(boardColumnDto),
});
export type BoardDto = z.infer<typeof boardDto>;
