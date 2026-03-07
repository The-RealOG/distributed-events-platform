import { z } from 'zod';

export { commentDto, taskDto, type CommentDto, type TaskDto } from '@dpp/contracts';

const expectedVersion = z.number().int().min(1);
const title = z.string().trim().min(1).max(500);
const description = z.string().max(20_000);

export const createTaskBody = z.object({
  projectId: z.uuid(),
  columnId: z.uuid(),
  title,
  description: description.default(''),
});

export const updateTaskBody = z
  .object({ expectedVersion, title: title.optional(), description: description.optional() })
  .refine((body) => body.title !== undefined || body.description !== undefined, {
    message: 'At least one of title or description is required',
  });

export const moveTaskBody = z.object({
  expectedVersion,
  columnId: z.uuid(),
  // Place the task directly after this one in the target column; null means top of column.
  afterTaskId: z.uuid().nullable(),
});

export const deleteTaskQuery = z.object({ expectedVersion: z.coerce.number().int().min(1) });

export const assignBody = z.object({ userId: z.uuid() });
export const assigneeParams = z.object({ id: z.uuid(), userId: z.uuid() });

export const createCommentBody = z.object({ body: z.string().trim().min(1).max(10_000) });
