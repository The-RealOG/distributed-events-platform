import { users, type DbExecutor } from '@dpp/database';
import { eq, sql } from 'drizzle-orm';

export type UserRow = typeof users.$inferSelect;

export async function upsertUserByEmail(
  ex: DbExecutor,
  email: string,
  displayName: string,
): Promise<UserRow> {
  const [row] = await ex
    .insert(users)
    .values({ email, displayName })
    .onConflictDoUpdate({
      target: users.email,
      set: { displayName, updatedAt: sql`now()` },
    })
    .returning();
  return row!;
}

export async function findUserById(ex: DbExecutor, id: string): Promise<UserRow | undefined> {
  const [row] = await ex.select().from(users).where(eq(users.id, id));
  return row;
}

export async function findUserByEmail(ex: DbExecutor, email: string): Promise<UserRow | undefined> {
  const [row] = await ex.select().from(users).where(eq(users.email, email));
  return row;
}
