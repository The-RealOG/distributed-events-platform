import type { TaskDto } from '@dpp/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNotify } from '../../components/Notices';
import { describeError, isApiError } from '../../lib/api/errors';
import { useApi } from '../../lib/AppProviders';
import { queryKeys } from '../../lib/query/keys';
import type { MoveRequest } from './moves';

/**
 * Server-confirmed task mutations. No optimistic updates: each success writes the returned
 * task into its cache entry and refetches only this project's board. Other writers exist
 * (other users, and the realtime channel later), so the board is always re-read from the server.
 */
export function useTaskMutations(projectId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  const notify = useNotify();

  const refreshBoard = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.board(projectId) });
  const storeTask = (task: TaskDto) => queryClient.setQueryData(queryKeys.task(task.id), task);

  /** Shared failure handling for actions triggered from the board rather than a form. */
  const reportBoardActionError = (error: unknown) => {
    if (isApiError(error, 'version_conflict')) {
      notify(
        'error',
        'That task was changed by someone else. The board has been refreshed; try again.',
      );
    } else if (isApiError(error, 'not_found')) {
      notify('error', 'That task no longer exists. The board has been refreshed.');
    } else if (isApiError(error, 'outcome_unknown')) {
      notify('error', 'That took too long and may have been saved. The board has been refreshed.');
    } else if (isApiError(error, 'validation')) {
      notify('error', 'The board was out of date. It has been refreshed; try again.');
    } else {
      notify('error', describeError(error));
    }
    void refreshBoard();
  };

  const create = useMutation({
    mutationFn: (input: { columnId: string; title: string }) =>
      api.createTask({ projectId, ...input }),
    onSuccess: (task) => {
      storeTask(task);
      void refreshBoard();
    },
  });

  const move = useMutation({
    mutationFn: ({ task, to }: { task: TaskDto; to: MoveRequest }) =>
      api.moveTask(task.id, { expectedVersion: task.version, ...to }),
    onSuccess: (task) => {
      storeTask(task);
      void refreshBoard();
    },
    onError: reportBoardActionError,
  });

  return { create, move, refreshBoard, storeTask };
}
