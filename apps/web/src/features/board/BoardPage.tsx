import type { BoardColumnDto, BoardDto, TaskDto } from '@dpp/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Outlet, useNavigate, useParams, useSearchParams } from 'react-router';
import { Avatar } from '../../components/Avatar';
import { ErrorNotice, Loading } from '../../components/ErrorNotice';
import { Icon } from '../../components/Icon';
import { describeError } from '../../lib/api/errors';
import { useApi } from '../../lib/AppProviders';
import { queryKeys } from '../../lib/query/keys';
import { ActivityPanel } from '../activity/ActivityPanel';
import { moveTargets } from './moves';
import { useTaskMutations } from './useTaskMutations';

type Tone = 'todo' | 'progress' | 'done';
/** First column = not started, last = done, anything between = in progress. */
const toneOf = (index: number, count: number): Tone =>
  index === 0 ? 'todo' : index === count - 1 ? 'done' : 'progress';

interface Filters {
  text: string;
  assignee: string; // '' = anyone, 'none' = unassigned, else a user id
}

const matches = (task: TaskDto, f: Filters) => {
  const text = f.text.trim().toLowerCase();
  if (text && !`${task.title} ${task.description}`.toLowerCase().includes(text)) return false;
  if (f.assignee === 'none') return task.assigneeIds.length === 0;
  if (f.assignee) return task.assigneeIds.includes(f.assignee);
  return true;
};

export function BoardPage() {
  const { projectId = '' } = useParams();
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'activity' ? 'activity' : 'board';
  const [filters, setFilters] = useState<Filters>({ text: '', assignee: '' });
  const [composerFor, setComposerFor] = useState<string | null>(null);
  const board = useQuery({
    queryKey: queryKeys.board(projectId),
    queryFn: ({ signal }) => api.getBoard(projectId, signal),
  });
  const workspaceId = board.data?.project.workspaceId ?? '';
  const members = useQuery({
    queryKey: queryKeys.workspaceMembers(workspaceId),
    queryFn: ({ signal }) => api.listMembers(workspaceId, signal),
    enabled: workspaceId !== '',
  });

  if (board.isPending) return <Loading label="Loading board" />;
  // Only a failed first load replaces the page. A failed refetch keeps the last board on
  // screen (clearly flagged) so a brief outage doesn't throw away the user's context.
  if (!board.data) return <ErrorNotice error={board.error} onRetry={() => void board.refetch()} />;

  const { project } = board.data;
  const names = new Map((members.data ?? []).map((m) => [m.userId, m.displayName]));
  const filtering = filters.text.trim() !== '' || filters.assignee !== '';
  const setView = (next: 'board' | 'activity') =>
    setParams(next === 'board' ? {} : { view: next }, { replace: true });

  return (
    <section className="project-page">
      <div className="project-header">
        <div>
          <h1>{project.name}</h1>
          {project.description && (
            <p className="muted project-description">{project.description}</p>
          )}
        </div>
        <div className="project-actions">
          {/* No realtime yet: another user's change shows up on refresh, refocus or a conflict. */}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void board.refetch()}
            disabled={board.isFetching}
          >
            <Icon name="refresh" size={16} />
            {board.isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setView('board');
              setComposerFor(board.data.columns[0]?.id ?? null);
            }}
          >
            <Icon name="plus" size={16} /> New task
          </button>
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label="Project views">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'board'}
          className={view === 'board' ? 'tab active' : 'tab'}
          onClick={() => setView('board')}
        >
          <Icon name="board" size={16} /> Board
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'activity'}
          className={view === 'activity' ? 'tab active' : 'tab'}
          onClick={() => setView('activity')}
        >
          <Icon name="activity" size={16} /> Activity
        </button>
      </div>

      {board.isError && (
        <>
          <p className="muted">Showing the board as last loaded.</p>
          <ErrorNotice error={board.error} onRetry={() => void board.refetch()} />
        </>
      )}

      {view === 'activity' ? (
        <ActivityPanel board={board.data} variant="page" />
      ) : (
        <>
          <div className="toolbar">
            <label className="search-field">
              <Icon name="search" size={16} />
              <span className="visually-hidden">Filter tasks</span>
              <input
                type="search"
                placeholder="Filter tasks…"
                value={filters.text}
                onChange={(e) => setFilters({ ...filters, text: e.target.value })}
              />
            </label>
            <label className="select-inline">
              <span className="visually-hidden">Assignee</span>
              <select
                value={filters.assignee}
                onChange={(e) => setFilters({ ...filters, assignee: e.target.value })}
              >
                <option value="">Assignee: anyone</option>
                <option value="none">Unassigned</option>
                {(members.data ?? []).map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            </label>
            {filtering && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setFilters({ text: '', assignee: '' })}
              >
                <Icon name="x" size={14} /> Clear
              </button>
            )}
          </div>

          <div className="board-layout">
            <div className="board">
              {board.data.columns.map((column, index) => (
                <Column
                  key={column.id}
                  board={board.data}
                  column={column}
                  tone={toneOf(index, board.data.columns.length)}
                  filters={filters}
                  names={names}
                  composing={composerFor === column.id}
                  onCompose={(open) => setComposerFor(open ? column.id : null)}
                />
              ))}
            </div>
            <ActivityPanel board={board.data} />
          </div>
        </>
      )}
      <Outlet context={board.data} />
    </section>
  );
}

function Column({
  board,
  column,
  tone,
  filters,
  names,
  composing,
  onCompose,
}: {
  board: BoardDto;
  column: BoardColumnDto;
  tone: Tone;
  filters: Filters;
  names: Map<string, string>;
  composing: boolean;
  onCompose: (open: boolean) => void;
}) {
  const { create } = useTaskMutations(board.project.id);
  const [title, setTitle] = useState('');
  const visible = column.tasks.filter((t) => matches(t, filters));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (create.isPending) return;
    create.mutate(
      { columnId: column.id, title: title.trim() },
      {
        onSuccess: () => {
          setTitle('');
          onCompose(false);
        },
      },
    );
  };

  return (
    <section className={`column tone-${tone}`} aria-labelledby={`col-${column.id}`}>
      <header className="column-header">
        <span className={`status-ring ring-${tone}`} aria-hidden="true" />
        <h2 id={`col-${column.id}`}>
          {column.name} <span className="count">{column.tasks.length}</span>
        </h2>
        <span className="spacer" />
        <button
          type="button"
          className="icon-button"
          aria-label={`Add a task to ${column.name}`}
          title="Add a task"
          onClick={() => onCompose(!composing)}
        >
          <Icon name="plus" size={16} />
        </button>
      </header>

      {column.tasks.length === 0 ? (
        <EmptyColumn tone={tone} />
      ) : visible.length === 0 ? (
        <p className="muted small no-match">No matching tasks</p>
      ) : (
        <ol className="tasks">
          {visible.map((task) => (
            <TaskCard key={task.id} board={board} task={task} tone={tone} names={names} />
          ))}
        </ol>
      )}

      {composing ? (
        <Composer
          column={column}
          title={title}
          setTitle={setTitle}
          submit={submit}
          pending={create.isPending}
          onCancel={() => onCompose(false)}
          error={create.isError ? describeError(create.error) : undefined}
        />
      ) : (
        <button type="button" className="add-task" onClick={() => onCompose(true)}>
          <Icon name="plus" size={16} /> Add a task
        </button>
      )}
    </section>
  );
}

function Composer({
  column,
  title,
  setTitle,
  submit,
  pending,
  onCancel,
  error,
}: {
  column: BoardColumnDto;
  title: string;
  setTitle: (t: string) => void;
  submit: (e: FormEvent) => void;
  pending: boolean;
  onCancel: () => void;
  error: string | undefined;
}) {
  return (
    <form onSubmit={submit} className="composer" aria-label={`Add task to ${column.name}`}>
      <label>
        <span className="visually-hidden">New task in {column.name}</span>
        <input
          autoFocus
          required
          maxLength={500}
          placeholder="What needs to be done?"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onCancel()}
        />
      </label>
      <div className="composer-actions">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? 'Adding…' : 'Add task'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error && (
        <p role="alert" className="notice notice-error">
          {error}
        </p>
      )}
    </form>
  );
}

function EmptyColumn({ tone }: { tone: Tone }) {
  const done = tone === 'done';
  return (
    <div className="empty-state">
      <span className={done ? 'empty-icon done' : 'empty-icon'}>
        <Icon name={done ? 'check' : 'plus'} />
      </span>
      <p className="empty-title">{done ? 'No completed tasks yet' : 'No tasks yet'}</p>
      <p className="muted small">
        {done
          ? 'Tasks moved here will show up as done'
          : tone === 'todo'
            ? 'Tasks added here will be ready to work on'
            : 'Move tasks here when work starts'}
      </p>
    </div>
  );
}

function TaskCard({
  board,
  task,
  tone,
  names,
}: {
  board: BoardDto;
  task: TaskDto;
  tone: Tone;
  names: Map<string, string>;
}) {
  const navigate = useNavigate();
  const { move } = useTaskMutations(board.project.id);
  const targets = moveTargets(board, task.id);
  const busy = move.isPending;

  return (
    <li className={`task-card accent-${tone}`}>
      <button
        type="button"
        className="task-title"
        onClick={() => void navigate(`/projects/${board.project.id}/tasks/${task.id}`)}
      >
        {task.title}
      </button>
      {task.description && <p className="task-description">{task.description}</p>}
      <div className="task-footer">
        <span className="assignees">
          {task.assigneeIds.map((id) => (
            <Avatar key={id} id={id} name={names.get(id) ?? '?'} size={24} />
          ))}
          {task.assigneeIds.length === 1 && (
            <span className="assignee-name">{names.get(task.assigneeIds[0]!) ?? '1 assigned'}</span>
          )}
          {task.assigneeIds.length > 1 && (
            <span className="assignee-name">{task.assigneeIds.length} assigned</span>
          )}
        </span>
        <span className="task-actions">
          <button
            type="button"
            className="icon-button"
            aria-label={`Move ${task.title} up`}
            disabled={busy || !targets.up}
            onClick={() => targets.up && move.mutate({ task, to: targets.up })}
          >
            <Icon name="arrowUp" size={14} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={`Move ${task.title} down`}
            disabled={busy || !targets.down}
            onClick={() => targets.down && move.mutate({ task, to: targets.down })}
          >
            <Icon name="arrowDown" size={14} />
          </button>
          <label className="visually-hidden" htmlFor={`move-${task.id}`}>
            Move {task.title} to column
          </label>
          <select
            id={`move-${task.id}`}
            className="move-select"
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
        </span>
      </div>
    </li>
  );
}
