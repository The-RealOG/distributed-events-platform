import type { ActivityEntryDto } from '@dpp/contracts';

export interface DescribeContext {
  /** Display names by user id (from the activity page). */
  people: Record<string, string>;
  /** Current column names by id (from the board). */
  columns: Record<string, string>;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/**
 * Words for one activity entry. The server stores facts (ids, titles, flags); wording lives
 * here, so it can change without touching history. Unknown types still render.
 */
export function describeActivity(entry: ActivityEntryDto, ctx: DescribeContext): string {
  const actor = ctx.people[entry.actorId] ?? 'Someone';
  const d = entry.data;
  const task = `“${str(d['title']) ?? str(d['taskTitle']) ?? 'a task'}”`;
  const column = (columnId: unknown) => {
    const name = str(columnId) && ctx.columns[str(columnId)!];
    return name ? `“${name}”` : 'another column';
  };
  const person = (userId: unknown) => (str(userId) && ctx.people[str(userId)!]) || 'someone';

  switch (entry.eventType) {
    case 'task.created':
      return `${actor} created ${task} in ${column(d['columnId'])}`;
    case 'task.updated': {
      const title = d['title'] as { previous?: string; current?: string } | undefined;
      const renamed = title?.previous && title.current;
      if (renamed && d['descriptionChanged'] === true) {
        return `${actor} renamed “${title.previous}” to “${title.current}” and edited its description`;
      }
      if (renamed) return `${actor} renamed “${title.previous}” to “${title.current}”`;
      return `${actor} edited the description of ${task}`;
    }
    case 'task.moved':
      return d['fromColumnId'] === d['toColumnId']
        ? `${actor} reordered ${task} in ${column(d['toColumnId'])}`
        : `${actor} moved ${task} from ${column(d['fromColumnId'])} to ${column(d['toColumnId'])}`;
    case 'task.deleted':
      return `${actor} deleted ${task}`;
    case 'task.assigned':
      return `${actor} assigned ${person(d['assigneeId'])} to ${task}`;
    case 'task.unassigned':
      return `${actor} unassigned ${person(d['assigneeId'])} from ${task}`;
    case 'comment.created':
      return `${actor} commented on ${task}: “${str(d['excerpt']) ?? ''}”`;
    default:
      return `${actor}: ${entry.eventType}`;
  }
}
