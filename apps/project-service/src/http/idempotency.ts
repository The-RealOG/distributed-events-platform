import { createHash } from 'node:crypto';
import { idempotencyKeys, sql, type DbTransaction } from '@dpp/database';
import { and, eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { AppError, badRequest } from './errors.js';

export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
const KEY_FORMAT = /^[\x21-\x7e]{1,255}$/; // visible ASCII, like any other header token

export interface IdempotentRequest {
  key: string;
  /** Identifies the request the key was first used for, so a reused key cannot replay it. */
  requestHash: string;
}

/** The request's idempotency key, if the client sent one. Only create endpoints read it. */
export function idempotencyOf(request: FastifyRequest): IdempotentRequest | undefined {
  const header = request.headers[IDEMPOTENCY_KEY_HEADER];
  if (header === undefined) return undefined;
  if (typeof header !== 'string' || !KEY_FORMAT.test(header)) {
    throw badRequest('Idempotency-Key must be 1–255 visible ASCII characters', {
      field: IDEMPOTENCY_KEY_HEADER,
    });
  }
  const requestHash = createHash('sha256')
    .update(`${request.method} ${request.url}\n${canonicalJson(request.body)}`)
    .digest('hex');
  return { key: header, requestHash };
}

/**
 * Runs `create` at most once per (user, key), inside the caller's transaction.
 *
 * The key row is inserted before the change and its response stored after it, in the same
 * transaction, so the key and the change commit or roll back together:
 * - first attempt: the insert succeeds, the change runs, the response is stored;
 * - retry after a commit: the insert conflicts and the stored response is returned;
 * - retry after a rollback: no row exists, so the change runs again;
 * - concurrent duplicate: its insert waits on the first transaction's unique-key entry, then
 *   either conflicts (first committed) or succeeds (first rolled back). No check-then-act gap.
 */
export async function createOnce<T>(
  tx: DbTransaction,
  userId: string,
  idempotency: IdempotentRequest | undefined,
  create: () => Promise<T>,
): Promise<T> {
  if (!idempotency) return create();
  const { key, requestHash } = idempotency;
  const claimed = await tx
    .insert(idempotencyKeys)
    .values({ userId, key, requestHash })
    .onConflictDoNothing()
    .returning({ key: idempotencyKeys.key });

  if (claimed.length === 0) {
    const [previous] = await tx
      .select({ requestHash: idempotencyKeys.requestHash, body: idempotencyKeys.responseBody })
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)));
    if (!previous || previous.requestHash !== requestHash) {
      throw new AppError(
        422,
        'IDEMPOTENCY_KEY_REUSED',
        'This Idempotency-Key was already used for a different request',
      );
    }
    return previous.body as T;
  }

  const response = await create();
  await tx
    .update(idempotencyKeys)
    .set({ responseStatus: 201, responseBody: response })
    .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)));
  return response;
}

/** Deletes keys older than the retention; a retry after that is treated as a new request. */
export async function deleteExpiredIdempotencyKeys(
  tx: DbTransaction,
  olderThanHours: number,
): Promise<number> {
  const result = await tx.execute(
    sql`DELETE FROM idempotency_keys WHERE created_at < now() - make_interval(hours => ${olderThanHours})`,
  );
  return result.rowCount ?? 0;
}

// Same body, same hash, regardless of the order in which the client serialized its keys.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}
