import type { BoardDto } from '@dpp/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ErrorNotice } from '../../components/ErrorNotice';
import { useApi } from '../../lib/AppProviders';
import { queryKeys } from '../../lib/query/keys';
import { describeActivity } from './describe';

// The activity history is built asynchronously from events (ADR-014), so it trails the board by
// a moment. Polling keeps it current without coupling it to the board's queries.
const POLL_MS = 5_000;

export function ActivityPanel({ board }: { board: BoardDto }) {
  const api = useApi();
  const projectId = board.project.id;
  const activity = useInfiniteQuery({
    queryKey: queryKeys.activity(projectId),
    queryFn: ({ pageParam, signal }) => api.getActivity(projectId, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: POLL_MS,
  });

  const columns = Object.fromEntries(board.columns.map((c) => [c.id, c.name]));
  const pages = activity.data?.pages ?? [];
  const people = Object.assign({}, ...pages.map((p) => p.people)) as Record<string, string>;
  const items = pages.flatMap((p) => p.items);

  return (
    <aside className="activity" aria-labelledby="activity-heading">
      <h2 id="activity-heading">Activity</h2>
      <p className="muted small">Updates a few seconds after changes.</p>
      {activity.isPending && <p className="muted">Loading activity…</p>}
      {activity.isError && !activity.data && (
        <ErrorNotice error={activity.error} onRetry={() => void activity.refetch()} />
      )}
      {activity.data && items.length === 0 && <p className="muted">No activity yet.</p>}
      <ol className="activity-list">
        {items.map((entry) => (
          <li key={entry.id}>
            <span>{describeActivity(entry, { people, columns })}</span>
            <time dateTime={entry.occurredAt} title={new Date(entry.occurredAt).toLocaleString()}>
              {new Date(entry.occurredAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </time>
          </li>
        ))}
      </ol>
      {activity.hasNextPage && (
        <button
          type="button"
          onClick={() => void activity.fetchNextPage()}
          disabled={activity.isFetchingNextPage}
        >
          {activity.isFetchingNextPage ? 'Loading…' : 'Show older'}
        </button>
      )}
    </aside>
  );
}
