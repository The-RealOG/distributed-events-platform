import type { ActivityEntryDto, BoardDto } from '@dpp/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Icon } from '../../components/Icon';
import { useApi } from '../../lib/AppProviders';
import { queryKeys } from '../../lib/query/keys';
import {
  activityView,
  dayLabel,
  describeActivity,
  type DescribeContext,
  type Part,
} from './describe';

// The activity history is built asynchronously from events (ADR-014), so it trails the board by
// a moment. Polling keeps it current without coupling it to the board's queries.
const POLL_MS = 5_000;

type Filter = 'all' | 'tasks' | 'comments';
const matches = (filter: Filter, entry: ActivityEntryDto) =>
  filter === 'all' ||
  (filter === 'comments'
    ? entry.eventType.startsWith('comment.')
    : entry.eventType.startsWith('task.'));

export function ActivityPanel({
  board,
  variant = 'side',
}: {
  board: BoardDto;
  variant?: 'side' | 'page';
}) {
  const api = useApi();
  const projectId = board.project.id;
  const [filter, setFilter] = useState<Filter>('all');
  const activity = useInfiniteQuery({
    queryKey: queryKeys.activity(projectId),
    queryFn: ({ pageParam, signal }) => api.getActivity(projectId, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: POLL_MS,
  });

  const pages = activity.data?.pages ?? [];
  const ctx: DescribeContext = {
    columns: Object.fromEntries(board.columns.map((c) => [c.id, c.name])),
    people: Object.assign({}, ...pages.map((p) => p.people)) as Record<string, string>,
  };
  const items = pages.flatMap((p) => p.items).filter((e) => matches(filter, e));
  const groups: { label: string; entries: ActivityEntryDto[] }[] = [];
  for (const entry of items) {
    const label = dayLabel(entry.occurredAt);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.entries.push(entry);
    else groups.push({ label, entries: [entry] });
  }

  return (
    <aside className={`activity card activity-${variant}`} aria-labelledby="activity-heading">
      <div className="activity-header">
        <h2 id="activity-heading">Activity</h2>
        <label className="select-inline">
          <span className="visually-hidden">Show</span>
          <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            <option value="all">All activity</option>
            <option value="tasks">Task changes</option>
            <option value="comments">Comments</option>
          </select>
        </label>
      </div>
      <p className="muted small">Updates a few seconds after changes.</p>
      {activity.isPending && <p className="muted">Loading activity…</p>}
      {activity.isError && !activity.data && (
        <ErrorNotice error={activity.error} onRetry={() => void activity.refetch()} />
      )}
      {activity.data && items.length === 0 && (
        <div className="empty-state compact">
          <span className="empty-icon">
            <Icon name="activity" />
          </span>
          <p>No activity yet.</p>
        </div>
      )}
      {groups.map((group) => (
        <section key={group.label} className="activity-day" aria-label={group.label}>
          <h3>{group.label}</h3>
          <ol className="timeline">
            {group.entries.map((entry) => (
              <Entry key={entry.id} entry={entry} ctx={ctx} />
            ))}
          </ol>
        </section>
      ))}
      {activity.hasNextPage && (
        <button
          type="button"
          className="btn btn-ghost btn-block"
          onClick={() => void activity.fetchNextPage()}
          disabled={activity.isFetchingNextPage}
        >
          {activity.isFetchingNextPage ? 'Loading…' : 'Show older'}
        </button>
      )}
    </aside>
  );
}

function Entry({ entry, ctx }: { entry: ActivityEntryDto; ctx: DescribeContext }) {
  const view = activityView(entry, ctx);
  const actor = ctx.people[entry.actorId] ?? 'Someone';
  const when = new Date(entry.occurredAt);
  return (
    <li className="timeline-item" aria-label={describeActivity(entry, ctx)}>
      <span className={`timeline-icon tone-${view.tone}`} aria-hidden="true">
        <Icon name={view.icon} size={16} />
      </span>
      <div className="timeline-body" aria-hidden="true">
        <div className="timeline-line">
          <span>
            <strong>{actor}</strong> {view.verb}
          </span>
          <time dateTime={entry.occurredAt} title={when.toLocaleString()}>
            {when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </time>
        </div>
        {view.subject && <p className="timeline-subject">“{view.subject}”</p>}
        {view.detail.length > 0 && (
          <p className="timeline-detail">
            {view.detail.map((part, i) => (
              <PartView key={i} part={part} />
            ))}
          </p>
        )}
      </div>
    </li>
  );
}

function PartView({ part }: { part: Part }) {
  switch (part.kind) {
    case 'chip':
      return <span className={part.accent ? 'chip chip-accent' : 'chip'}>{part.text}</span>;
    case 'strong':
      return <strong>{part.text}</strong>;
    case 'quote':
      return <q>{part.text}</q>;
    default:
      return <span>{part.text}</span>;
  }
}
