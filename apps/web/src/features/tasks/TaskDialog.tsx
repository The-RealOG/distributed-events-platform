import type { BoardDto } from '@dpp/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router';
import { ErrorNotice, Loading } from '../../components/ErrorNotice';
import { useNotify } from '../../components/Notices';
import { describeError, isApiError } from '../../lib/api/errors';
import { useApi } from '../../lib/AppProviders';
import { queryKeys } from '../../lib/query/keys';
import { Assignees } from './Assignees';
import { Attachments } from './Attachments';
import { Comments } from './Comments';
import { TaskEditor } from './TaskEditor';

/** Task detail as a modal over the board, addressable at /projects/:projectId/tasks/:taskId. */
export function TaskDialog() {
  const { projectId = '', taskId = '' } = useParams();
  const board = useOutletContext<BoardDto>();
  const api = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const notify = useNotify();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const close = () => void navigate(`/projects/${projectId}`);

  // A native modal dialog traps focus, handles Escape and restores focus on close.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
  }, []);

  const task = useQuery({
    queryKey: queryKeys.task(taskId),
    queryFn: ({ signal }) => api.getTask(taskId, signal),
  });

  const gone = isApiError(task.error, 'not_found');
  useEffect(() => {
    if (gone) void queryClient.invalidateQueries({ queryKey: queryKeys.board(projectId) });
  }, [gone, projectId, queryClient]);

  const remove = useMutation({
    mutationFn: (expectedVersion: number) => api.deleteTask(taskId, expectedVersion),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: queryKeys.task(taskId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.board(projectId) });
      notify('info', 'Task deleted.');
      close();
    },
    onError: (error) => {
      setConfirmingDelete(false);
      if (isApiError(error, 'version_conflict')) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.task(taskId), exact: true });
      }
    },
  });

  return (
    <dialog
      ref={dialogRef}
      className="task-dialog"
      aria-labelledby="task-dialog-title"
      onClose={close}
    >
      <div className="dialog-header">
        <h2 id="task-dialog-title">{task.data?.title ?? 'Task'}</h2>
        <button type="button" onClick={close} aria-label="Close task">
          ×
        </button>
      </div>

      {task.isPending && <Loading label="Loading task" />}
      {gone && (
        <div role="alert" className="notice notice-error">
          <p>This task no longer exists. Someone may have deleted it.</p>
          <button type="button" onClick={close}>
            Back to board
          </button>
        </div>
      )}
      {task.isError && !gone && (
        <ErrorNotice error={task.error} onRetry={() => void task.refetch()} />
      )}

      {task.data && !gone && (
        <div className="stack">
          <TaskEditor key={task.data.id} task={task.data} projectId={projectId} />
          <Assignees
            task={task.data}
            projectId={projectId}
            workspaceId={board.project.workspaceId}
          />
          <Attachments taskId={task.data.id} />
          <Comments taskId={task.data.id} />
          <section className="stack danger-zone">
            {remove.isError && (
              <p role="alert" className="notice notice-error">
                {isApiError(remove.error, 'version_conflict')
                  ? 'This task changed since you opened it. Review the latest version before deleting.'
                  : describeError(remove.error)}
              </p>
            )}
            {confirmingDelete ? (
              <div className="row">
                <span>Delete this task?</span>
                <button
                  type="button"
                  className="danger"
                  disabled={remove.isPending}
                  onClick={() => task.data && remove.mutate(task.data.version)}
                >
                  {remove.isPending ? 'Deleting…' : 'Confirm delete'}
                </button>
                <button type="button" onClick={() => setConfirmingDelete(false)}>
                  Cancel
                </button>
              </div>
            ) : (
              <button type="button" className="danger" onClick={() => setConfirmingDelete(true)}>
                Delete task
              </button>
            )}
          </section>
        </div>
      )}
    </dialog>
  );
}
