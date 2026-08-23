import {
  activityPageDto,
  attachmentDownloadDto,
  attachmentDto,
  attachmentUploadDto,
  boardDto,
  commentDto,
  devLoginResponse,
  memberDto,
  projectDto,
  taskDto,
  userDto,
  workspaceDto,
} from '@dpp/contracts';
import { z } from 'zod';
import type { ApiClient } from './client';

export type Api = ReturnType<typeof createApi>;

const id = encodeURIComponent;

/** Typed endpoint functions. Paths are relative to the gateway's /api base. */
export function createApi(client: ApiClient) {
  const r = client.request.bind(client);
  return {
    devLogin: (email: string, displayName: string) =>
      r('POST', '/auth/dev-login', { body: { email, displayName }, schema: devLoginResponse }),
    me: (signal?: AbortSignal) => r('GET', '/me', { schema: userDto, signal }),

    listWorkspaces: (signal?: AbortSignal) =>
      r('GET', '/workspaces', { schema: z.array(workspaceDto), signal }),
    createWorkspace: (name: string) =>
      r('POST', '/workspaces', { body: { name }, schema: workspaceDto }),
    getWorkspace: (workspaceId: string, signal?: AbortSignal) =>
      r('GET', `/workspaces/${id(workspaceId)}`, { schema: workspaceDto, signal }),
    listMembers: (workspaceId: string, signal?: AbortSignal) =>
      r('GET', `/workspaces/${id(workspaceId)}/members`, { schema: z.array(memberDto), signal }),
    addMember: (workspaceId: string, email: string, role: 'ADMIN' | 'MEMBER') =>
      r('POST', `/workspaces/${id(workspaceId)}/members`, {
        body: { email, role },
        schema: memberDto,
      }),

    listProjects: (workspaceId: string, signal?: AbortSignal) =>
      r('GET', `/workspaces/${id(workspaceId)}/projects`, { schema: z.array(projectDto), signal }),
    createProject: (workspaceId: string, name: string) =>
      r('POST', '/projects', { body: { workspaceId, name }, schema: projectDto }),
    getBoard: (projectId: string, signal?: AbortSignal) =>
      r('GET', `/projects/${id(projectId)}/board`, { schema: boardDto, signal }),
    getActivity: (projectId: string, before?: string, signal?: AbortSignal) =>
      r('GET', `/projects/${id(projectId)}/activity${before ? `?before=${id(before)}` : ''}`, {
        schema: activityPageDto,
        signal,
      }),

    createTask: (input: { projectId: string; columnId: string; title: string }) =>
      r('POST', '/tasks', { body: input, schema: taskDto }),
    getTask: (taskId: string, signal?: AbortSignal) =>
      r('GET', `/tasks/${id(taskId)}`, { schema: taskDto, signal }),
    updateTask: (
      taskId: string,
      input: { expectedVersion: number; title?: string; description?: string },
    ) => r('PATCH', `/tasks/${id(taskId)}`, { body: input, schema: taskDto }),
    moveTask: (
      taskId: string,
      input: { expectedVersion: number; columnId: string; afterTaskId: string | null },
    ) => r('POST', `/tasks/${id(taskId)}/move`, { body: input, schema: taskDto }),
    deleteTask: (taskId: string, expectedVersion: number) =>
      r('DELETE', `/tasks/${id(taskId)}?expectedVersion=${expectedVersion}`),
    assign: (taskId: string, userId: string) =>
      r('POST', `/tasks/${id(taskId)}/assignees`, { body: { userId }, schema: taskDto }),
    unassign: (taskId: string, userId: string) =>
      r('DELETE', `/tasks/${id(taskId)}/assignees/${id(userId)}`),

    listAttachments: (taskId: string, signal?: AbortSignal) =>
      r('GET', `/tasks/${id(taskId)}/attachments`, { schema: z.array(attachmentDto), signal }),
    requestAttachmentUpload: (
      taskId: string,
      input: { filename: string; contentType: string; sizeBytes: number },
    ) =>
      r('POST', `/tasks/${id(taskId)}/attachments`, { body: input, schema: attachmentUploadDto }),
    completeAttachment: (attachmentId: string) =>
      r('POST', `/attachments/${id(attachmentId)}/complete`, { schema: attachmentDto }),
    attachmentDownload: (attachmentId: string) =>
      r('GET', `/attachments/${id(attachmentId)}/download`, { schema: attachmentDownloadDto }),
    deleteAttachment: (attachmentId: string) => r('DELETE', `/attachments/${id(attachmentId)}`),
    listComments: (taskId: string, signal?: AbortSignal) =>
      r('GET', `/tasks/${id(taskId)}/comments`, { schema: z.array(commentDto), signal }),
    addComment: (taskId: string, body: string) =>
      r('POST', `/tasks/${id(taskId)}/comments`, { body: { body }, schema: commentDto }),
  };
}
