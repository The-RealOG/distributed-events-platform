import type { BoardColumnDto, BoardDto, TaskDto } from '@dpp/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, Outlet, useNavigate, useParams } from 'react-router';
import { ErrorNotice, Loading } from '../../components/ErrorNotice';
import { describeError } from '../../lib/api/errors';
import { useApi } from '../../lib/AppProviders';
import { ActivityPanel } from '../activity/ActivityPanel';
import { queryKeys } from '../../lib/query/keys';
import { moveTargets } from './moves';
import { useTaskMutations } from './useTaskMutations';

export function BoardPage() {
  const { projectId = '' } = useParams();
  const api = useApi();
  const board = useQuery({
    queryKey: queryKeys.board(projectId),
    queryFn: ({ signal }) => api.getBoard(projectId, signal),
  });

  if (board.isPending) return <Loading label="Loading board" />;
  // Only a failed first load replaces the page. A failed refetch keeps the last board on
  // screen (clearly flagged) so a brief outage doesn't throw away the user's context.
  if (!board.data) return <ErrorNotice error={board.error} onRetry={() => void board.refetch()} />;

  const { project } = board.data;
  return (
    <section className="stack">
      <p>
        <Link to={`/workspaces/${project.workspaceId}`}>← Workspace</Link>
      </p>
      <div className="board-header">
        <h1>{project.name}</h1>
        {/* No realtime yet: another user's change shows up on refresh, refocus or a conflict. */}
        <button type="button" onClick={() => void board.refetch()} disabled={board.isFetching}>
          {board.isFetching ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      {board.isError && (
        <>
          <p className="muted">Showing the board as last loaded.</p>
          <ErrorNotice error={board.error} onRetry={() => void board.refetch()} />
        </>
      )}
      <div className="board-layout">
        <div className="board">
          {board.data.columns.map((column) => (
            <Column key={column.id} board={board.data} column={column} />
          ))}
        </div>
        <ActivityPanel board={board.data} />
      </div>
      <Outlet context={board.data} />
    </section>
  );
}

function Column({ board, column }: { board: BoardDto; column: BoardColumnDto }) {
  const { create } = useTaskMutations(board.project.id);
  const [title, setTitle] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (create.isPending) return;
    create.mutate({ columnId: column.id, title: title.trim() }, { onSuccess: () => setTitle('') });
  };

  return (
    <section className="column" aria-labelledby={`col-${column.id}`}>
      <h2 id={`col-${column.id}`}>
        {column.name} <span className="muted">({column.tasks.length})</span>
      </h2>
      {column.tasks.length === 0 ? (
        <p className="muted empty">No tasks</p>
      ) : (
        <ol className="tasks">
          {column.tasks.map((task) => (
            <TaskCard key={task.id} board={board} task={task} />
          ))}
        </ol>
      )}
      <form onSubmit={submit} className="stack" aria-label={`Add task to ${column.name}`}>
        <label>
          New task in {column.name}
          <input
            required
            maxLength={500}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Adding…' : 'Add task'}
        </button>
        {create.isError && (
          <p role="alert" className="notice notice-error">
            {describeError(create.error)}
          </p>
        )}
      </form>
    </section>
  );
}

function TaskCard({ board, task }: { board: BoardDto; task: TaskDto }) {
  const navigate = useNavigate();
  const { move } = useTaskMutations(board.project.id);
  const targets = moveTargets(board, task.id);
  const busy = move.isPending;

  return (
    <li className="task-card">
      <button
        type="button"
        className="link-button task-title"
        onClick={() => void navigate(`/projects/${board.project.id}/tasks/${task.id}`)}
      >
        {task.title}
      </button>
      {task.assigneeIds.length > 0 && (
        <span className="muted"> · {task.assigneeIds.length} assigned</span>
      )}
      <div className="task-actions">
        <button
          type="button"
          aria-label={`Move ${task.title} up`}
          disabled={busy || !targets.up}
          onClick={() => targets.up && move.mutate({ task, to: targets.up })}
        >
          ↑
        </button>
        <button
          type="button"
          aria-label={`Move ${task.title} down`}
          disabled={busy || !targets.down}
          onClick={() => targets.down && move.mutate({ task, to: targets.down })}
        >
          ↓
        </button>
        <label className="visually-hidden" htmlFor={`move-${task.id}`}>
          Move {task.title} to column
        </label>
        <select
          id={`move-${task.id}`}
          value={task.columnId}
          disabled={busy}
          onChange={(e) => {
            const to = targets.toColumn(e.target.value);
            if (to) move.mutate({ task, to });
          }}
        >
          {board.columns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
    </li>
  );
}
