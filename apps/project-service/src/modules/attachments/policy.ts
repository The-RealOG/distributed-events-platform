import { ATTACHMENT_CONTENT_TYPES } from '@dpp/contracts';

/**
 * The file name is metadata only; object keys are generated (see objectKey). This keeps the
 * display name readable while removing anything that could confuse a path, header or log line.
 */
export function cleanFilename(raw: string): string {
  const base = raw.split(/[/\\]/).pop() ?? '';
  const cleaned = base
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 255);
  return cleaned || 'file';
}

/** Controlled, collision-free key: tenant path + server-generated ID. Never user input. */
export function objectKey(ids: {
  workspaceId: string;
  projectId: string;
  taskId: string;
  attachmentId: string;
}): string {
  return `workspaces/${ids.workspaceId}/projects/${ids.projectId}/tasks/${ids.taskId}/${ids.attachmentId}`;
}

export const isAllowedContentType = (type: string): boolean =>
  (ATTACHMENT_CONTENT_TYPES as readonly string[]).includes(type);
