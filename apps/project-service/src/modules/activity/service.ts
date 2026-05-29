import type { Principal } from '@dpp/auth';
import type { ActivityPageDto } from '@dpp/contracts';
import type { Database } from '@dpp/database';
import { requireProjectRole } from '../../domain/access.js';
import { REQUIRED_ROLE } from '../../domain/roles.js';
import { iso } from '../../http/schemas.js';
import { displayNames, listProjectActivity } from './repository.js';

/**
 * Reads the activity projection that the Activity Service writes (ADR-014). The projection is
 * eventually consistent: a change that just returned 200 may not be listed yet. This service
 * only reads it, under the same project authorization as the board.
 */
export class ActivityService {
  constructor(private readonly db: Database) {}

  async list(
    principal: Principal,
    projectId: string,
    page: { limit: number; before?: string | undefined },
  ): Promise<ActivityPageDto> {
    await requireProjectRole(this.db, principal.userId, projectId, REQUIRED_ROLE.readProject);
    // One extra row tells whether an older page exists.
    const rows = await listProjectActivity(this.db, projectId, {
      limit: page.limit + 1,
      before: page.before === undefined ? undefined : BigInt(page.before),
    });
    const items = rows.slice(0, page.limit);
    const referenced = new Set<string>();
    for (const row of items) {
      referenced.add(row.actorId);
      const assignee = row.data['assigneeId'];
      if (typeof assignee === 'string') referenced.add(assignee);
    }
    const names = await displayNames(this.db, [...referenced]);
    return {
      items: items.map((row) => ({
        id: row.id.toString(),
        eventId: row.eventId,
        eventType: row.eventType,
        taskId: row.taskId,
        actorId: row.actorId,
        data: row.data,
        occurredAt: iso(row.occurredAt),
        correlationId: row.correlationId,
      })),
      nextCursor: rows.length > page.limit ? items[items.length - 1]!.id.toString() : null,
      people: Object.fromEntries(names),
    };
  }
}
