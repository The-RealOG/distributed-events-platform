import { activityEvents, users, type DbExecutor } from '@dpp/database';
import { and, desc, eq, inArray, lt } from 'drizzle-orm';

export type ActivityRow = typeof activityEvents.$inferSelect;

/** One page of a project's activity, newest first (by the persisted id order). */
export async function listProjectActivity(
  ex: DbExecutor,
  projectId: string,
  options: { limit: number; before?: bigint | undefined },
): Promise<ActivityRow[]> {
  return ex
    .select()
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.projectId, projectId),
        options.before === undefined ? undefined : lt(activityEvents.id, options.before),
      ),
    )
    .orderBy(desc(activityEvents.id))
    .limit(options.limit);
}

export async function displayNames(ex: DbExecutor, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await ex
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, ids));
  return new Map(rows.map((r) => [r.id, r.displayName]));
}
