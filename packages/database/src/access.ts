import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from './client.js';
import { projects, workspaceMembers } from './schema.js';

/**
 * Whether a user may read a project: any membership of the project's workspace (MEMBER is the
 * lowest role, and reading a project requires MEMBER; see the Project Service's REQUIRED_ROLE).
 * Used by services other than the Project Service that must enforce the same rule (realtime
 * subscriptions), without calling back over HTTP.
 */
export async function projectReadAccess(
  ex: DbExecutor,
  userId: string,
  projectId: string,
): Promise<'allowed' | 'forbidden' | 'not_found'> {
  const [row] = await ex
    .select({ role: workspaceMembers.role })
    .from(projects)
    .leftJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, projects.workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .where(eq(projects.id, projectId));
  if (!row) return 'not_found';
  return row.role === null ? 'forbidden' : 'allowed';
}
