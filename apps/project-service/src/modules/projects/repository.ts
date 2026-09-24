import { boardColumns, boards, projects, type DbExecutor } from '@dpp/database';
import { asc, eq } from 'drizzle-orm';

export type ProjectRow = typeof projects.$inferSelect;

export const DEFAULT_COLUMNS = ['To Do', 'In Progress', 'Done'] as const;

export async function insertProjectWithBoard(
  ex: DbExecutor,
  values: { workspaceId: string; name: string; description: string; createdBy: string },
): Promise<ProjectRow> {
  const [project] = await ex.insert(projects).values(values).returning();
  const [board] = await ex
    .insert(boards)
    .values({ projectId: project!.id, name: project!.name })
    .returning();
  await ex.insert(boardColumns).values(
    DEFAULT_COLUMNS.map((name, index) => ({
      boardId: board!.id,
      name,
      position: String((index + 1) * 1024),
    })),
  );
  return project!;
}

export async function listProjectsInWorkspace(ex: DbExecutor, workspaceId: string) {
  return ex
    .select()
    .from(projects)
    .where(eq(projects.workspaceId, workspaceId))
    .orderBy(asc(projects.createdAt));
}
