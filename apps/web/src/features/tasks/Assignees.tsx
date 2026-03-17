import type { TaskDto } from '@dpp/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorNotice, Loading } from '../../components/ErrorNotice';
import { describeError } from '../../lib/api/errors';
import { useApi } from '../../lib/AppProviders';
import { queryKeys } from '../../lib/query/keys';

export function Assignees({
  task,
  projectId,
  workspaceId,
}: {
  task: TaskDto;
  projectId: string;
  workspaceId: string;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState('');
  const members = useQuery({
    queryKey: queryKeys.workspaceMembers(workspaceId),
    queryFn: ({ signal }) => api.listMembers(workspaceId, signal),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.task(task.id), exact: true });
    void queryClient.invalidateQueries({ queryKey: queryKeys.board(projectId) });
  };
  const assign = useMutation({
    mutationFn: (userId: string) => api.assign(task.id, userId),
    onSuccess: () => {
      setSelected('');
      refresh();
    },
  });
  const unassign = useMutation({
    mutationFn: (userId: string) => api.unassign(task.id, userId),
    onSuccess: refresh,
  });

  if (members.isPending) return <Loading label="Loading members" />;
  if (members.isError)
    return <ErrorNotice error={members.error} onRetry={() => void members.refetch()} />;

  const nameOf = (userId: string) =>
    members.data.find((m) => m.userId === userId)?.displayName ?? 'Former member';
  const unassigned = members.data.filter((m) => !task.assigneeIds.includes(m.userId));
  const busy = assign.isPending || unassign.isPending;
  const error = assign.error ?? unassign.error;

  return (
    <section className="stack" aria-labelledby="assignees-heading">
      <h3 id="assignees-heading">Assignees</h3>
      {task.assigneeIds.length === 0 ? (
        <p className="muted">Nobody is assigned.</p>
      ) : (
        <ul className="list">
          {task.assigneeIds.map((userId) => (
            <li key={userId}>
              {nameOf(userId)}{' '}
              <button
                type="button"
                disabled={busy}
                onClick={() => unassign.mutate(userId)}
                aria-label={`Unassign ${nameOf(userId)}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {unassigned.length > 0 && (
        <div className="row">
          <label>
            Assign member
            <select value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">Choose…</option>
              {unassigned.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.displayName}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={busy || !selected}
            onClick={() => assign.mutate(selected)}
          >
            Assign
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="notice notice-error">
          {describeError(error)}
        </p>
      )}
    </section>
  );
}
