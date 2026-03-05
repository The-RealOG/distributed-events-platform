import { users, workspaceMembers, workspaces, type DbExecutor } from '@dpp/database';
import { and, asc, eq } from 'drizzle-orm';
import type { WorkspaceRole } from '../../domain/roles.js';

export type WorkspaceRow = typeof workspaces.$inferSelect;

export async function insertWorkspace(
  ex: DbExecutor,
  values: { name: string; createdBy: string },
): Promise<WorkspaceRow> {
  const [row] = await ex.insert(workspaces).values(values).returning();
  return row!;
}

export async function insertMember(
  ex: DbExecutor,
  values: { workspaceId: string; userId: string; role: WorkspaceRole },
): Promise<void> {
  await ex.insert(workspaceMembers).values(values);
}

export async function findMemberRole(
  ex: DbExecutor,
  workspaceId: string,
  userId: string,
): Promise<WorkspaceRole | undefined> {
  const [row] = await ex
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
  return row?.role;
}

export async function listWorkspacesForUser(ex: DbExecutor, userId: string) {
  return ex
    .select({ workspace: workspaces, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(asc(workspaces.createdAt));
}

export async function listMembers(ex: DbExecutor, workspaceId: string) {
  return ex
    .select({
      userId: users.id,
      email: users.email,
      displayName: users.displayName,
      role: workspaceMembers.role,
      joinedAt: workspaceMembers.createdAt,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(asc(workspaceMembers.createdAt));
}
