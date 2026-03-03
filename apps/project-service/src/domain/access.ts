import { projects, tasks, workspaceMembers, workspaces, type DbExecutor } from '@dpp/database';
import { and, eq, isNull } from 'drizzle-orm';
import { forbidden, notFound } from '../http/errors.js';
import { hasRole, type WorkspaceRole } from './roles.js';

// Each check resolves the resource and the caller's membership in one query, then applies
// the same order everywhere: missing resource → 404, not a member / insufficient role → 403.
// Checks run on the caller's executor so they share the mutation's transaction.

function authorize(role: WorkspaceRole | null, required: WorkspaceRole): WorkspaceRole {
  if (role === null || !hasRole(role, required)) throw forbidden();
  return role;
}

export async function requireWorkspaceRole(
  ex: DbExecutor,
  userId: string,
  workspaceId: string,
  required: WorkspaceRole,
) {
  const [row] = await ex
    .select({ workspace: workspaces, role: workspaceMembers.role })
    .from(workspaces)
    .leftJoin(
      workspaceMembers,
      and(eq(workspaceMembers.workspaceId, workspaces.id), eq(workspaceMembers.userId, userId)),
    )
    .where(eq(workspaces.id, workspaceId));
  if (!row) throw notFound('Workspace');
  return { workspace: row.workspace, role: authorize(row.role, required) };
}

export async function requireProjectRole(
  ex: DbExecutor,
  userId: string,
  projectId: string,
  required: WorkspaceRole,
) {
  const [row] = await ex
    .select({ project: projects, role: workspaceMembers.role })
    .from(projects)
    .leftJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, projects.workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .where(eq(projects.id, projectId));
  if (!row) throw notFound('Project');
  return { project: row.project, role: authorize(row.role, required) };
}

export async function requireTaskRole(
  ex: DbExecutor,
  userId: string,
  taskId: string,
  required: WorkspaceRole,
) {
  const [row] = await ex
    .select({ task: tasks, workspaceId: projects.workspaceId, role: workspaceMembers.role })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .leftJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, projects.workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .where(and(eq(tasks.id, taskId), isNull(tasks.deletedAt)));
  if (!row) throw notFound('Task');
  return { task: row.task, workspaceId: row.workspaceId, role: authorize(row.role, required) };
}
