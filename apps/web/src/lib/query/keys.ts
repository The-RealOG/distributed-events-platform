/**
 * Every query key in the app. Keys are hierarchical so a mutation can invalidate exactly the
 * data it affected, e.g. `task(id)` also matches `taskComments(id)`.
 */
export const queryKeys = {
  me: () => ['me'] as const,
  workspaces: () => ['workspaces'] as const,
  workspace: (workspaceId: string) => ['workspace', workspaceId] as const,
  workspaceMembers: (workspaceId: string) => ['workspace', workspaceId, 'members'] as const,
  workspaceProjects: (workspaceId: string) => ['workspace', workspaceId, 'projects'] as const,
  board: (projectId: string) => ['board', projectId] as const,
  // Not under board(): the activity projection lags the board, so it is polled on its own.
  activity: (projectId: string) => ['activity', projectId] as const,
  task: (taskId: string) => ['task', taskId] as const,
  taskComments: (taskId: string) => ['task', taskId, 'comments'] as const,
};
