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

export type Part =
  | { kind: 'text'; text: string }
  | { kind: 'chip'; text: string; accent?: boolean }
  | { kind: 'strong'; text: string }
  | { kind: 'quote'; text: string };

export interface ActivityView {
  tone: 'purple' | 'green' | 'blue' | 'red' | 'amber' | 'gray';
  icon: 'swap' | 'plus' | 'pencil' | 'trash' | 'userPlus' | 'userMinus' | 'message' | 'activity';
  /** "moved a task", "created a task", … */
  verb: string;
  /** The task (or comment's task) title, shown quoted on its own line. */
  subject?: string | undefined;
  detail: Part[];
}

/** The same facts as describeActivity, split for the timeline's visual layout. */
export function activityView(entry: ActivityEntryDto, ctx: DescribeContext): ActivityView {
  const d = entry.data;
  const title = str(d['title']) ?? str(d['taskTitle']);
  const col = (id: unknown): string => (str(id) && ctx.columns[str(id)!]) || 'another column';
  const person = (id: unknown) => (str(id) && ctx.people[str(id)!]) || 'someone';
  switch (entry.eventType) {
    case 'task.created':
      return {
        tone: 'green',
        icon: 'plus',
        verb: 'created a task',
        subject: title,
        detail: [
          { kind: 'text', text: 'in' },
          { kind: 'chip', text: col(d['columnId']) },
        ],
      };
    case 'task.moved':
      return d['fromColumnId'] === d['toColumnId']
        ? {
            tone: 'purple',
            icon: 'swap',
            verb: 'reordered a task',
            subject: title,
            detail: [
              { kind: 'text', text: 'in' },
              { kind: 'chip', text: col(d['toColumnId']) },
            ],
          }
        : {
            tone: 'purple',
            icon: 'swap',
            verb: 'moved a task',
            subject: title,
            detail: [
              { kind: 'text', text: 'from' },
              { kind: 'chip', text: col(d['fromColumnId']) },
              { kind: 'text', text: '→' },
              { kind: 'chip', text: col(d['toColumnId']), accent: true },
            ],
          };
    case 'task.updated': {
      const t = d['title'] as { previous?: string; current?: string } | undefined;
      const renamed = Boolean(t?.previous && t.current);
      const parts: Part[] = [];
      if (renamed) parts.push({ kind: 'text', text: 'was' }, { kind: 'chip', text: t!.previous! });
      if (d['descriptionChanged'] === true) {
        parts.push({ kind: 'text', text: renamed ? '· description edited' : 'description edited' });
      }
      return {
        tone: 'blue',
        icon: 'pencil',
        verb: renamed ? 'renamed a task' : 'edited a task',
        subject: renamed ? t!.current : title,
        detail: parts,
      };
    }
    case 'task.deleted':
      return { tone: 'red', icon: 'trash', verb: 'deleted a task', subject: title, detail: [] };
    case 'task.assigned':
      return {
        tone: 'amber',
        icon: 'userPlus',
        verb: 'assigned a task',
        subject: title,
        detail: [
          { kind: 'text', text: 'to' },
          { kind: 'strong', text: person(d['assigneeId']) },
        ],
      };
    case 'task.unassigned':
      return {
        tone: 'gray',
        icon: 'userMinus',
        verb: 'unassigned a task',
        subject: title,
        detail: [
          { kind: 'text', text: 'from' },
          { kind: 'strong', text: person(d['assigneeId']) },
        ],
      };
    case 'comment.created':
      return {
        tone: 'blue',
        icon: 'message',
        verb: 'commented on',
        subject: title,
        detail: [{ kind: 'quote', text: str(d['excerpt']) ?? '' }],
      };
    default:
      return { tone: 'gray', icon: 'activity', verb: entry.eventType, detail: [] };
  }
}

/** "Today", "Yesterday", or a date, for grouping the timeline. */
export function dayLabel(iso: string, now = new Date()): string {
  const day = new Date(iso);
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((startOf(now) - startOf(day)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return day.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}
