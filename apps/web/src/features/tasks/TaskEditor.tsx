import type { TaskDto } from '@dpp/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { describeError, isApiError } from '../../lib/api/errors';
import { useApi } from '../../lib/AppProviders';
import { queryKeys } from '../../lib/query/keys';

type Snapshot = Pick<TaskDto, 'version' | 'title' | 'description'>;

/**
 * Edits title and description against the version the user started from.
 *
 * On 409 the editor never resubmits and never discards the user's text. It refetches the
 * authoritative task, shows it next to the user's draft, and requires an explicit choice:
 * discard the draft, or keep it (rebased on the version now on screen) and save again.
 */
export function TaskEditor({ task, projectId }: { task: TaskDto; projectId: string }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [base, setBase] = useState<Snapshot>(task);
  const [draft, setDraft] = useState({ title: task.title, description: task.description });
  const [conflict, setConflict] = useState(false);

  const dirty = draft.title !== base.title || draft.description !== base.description;

  // Follow server changes while the user has nothing unsaved (e.g. after a refetch).
  if (!dirty && !conflict && task.version !== base.version) {
    setBase(task);
    setDraft({ title: task.title, description: task.description });
  }

  const save = useMutation({
    mutationFn: () =>
      api.updateTask(task.id, {
        expectedVersion: base.version,
        title: draft.title.trim(),
        description: draft.description,
      }),
    onSuccess: (updated) => {
      setBase(updated);
      setDraft({ title: updated.title, description: updated.description });
      queryClient.setQueryData(queryKeys.task(updated.id), updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.board(projectId) });
    },
    onError: (error) => {
      if (!isApiError(error, 'version_conflict')) return;
      setConflict(true);
      void queryClient.invalidateQueries({ queryKey: queryKeys.task(task.id), exact: true });
      void queryClient.invalidateQueries({ queryKey: queryKeys.board(projectId) });
    },
  });

  const latestLoaded = task.version > base.version;

  const discardMine = () => {
    setBase(task);
    setDraft({ title: task.title, description: task.description });
    setConflict(false);
    save.reset();
  };
  const keepMine = () => {
    // The user has now seen the latest version; saving will intentionally replace it.
    setBase(task);
    setConflict(false);
    save.reset();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!save.isPending && !conflict && dirty) save.mutate();
  };

  return (
    <form onSubmit={submit} className="stack" aria-label="Edit task">
      {conflict && (
        <div role="alert" className="notice notice-warning conflict">
          <p>
            <strong>This task was changed by someone else</strong> after you opened it. Your changes
            were not saved.
          </p>
          {latestLoaded ? (
            <>
              <p>Latest saved version (v{task.version}):</p>
              <dl className="latest">
                <dt>Title</dt>
                <dd data-testid="latest-title">{task.title}</dd>
                <dt>Description</dt>
                <dd>{task.description || <span className="muted">(empty)</span>}</dd>
              </dl>
              <p>Your edits are still in the form below.</p>
              <div className="row">
                <button type="button" onClick={discardMine}>
                  Discard my edits
                </button>
                <button type="button" onClick={keepMine}>
                  Keep my edits and review
                </button>
              </div>
            </>
          ) : (
            <p role="status">Loading the latest version…</p>
          )}
        </div>
      )}

      <label>
        Title
        <input
          required
          maxLength={500}
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        />
      </label>
      <label>
        Description
        <textarea
          rows={4}
          maxLength={20_000}
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        />
      </label>
      {save.isError && !conflict && !isApiError(save.error, 'version_conflict') && (
        <p role="alert" className="notice notice-error">
          {describeError(save.error)}
        </p>
      )}
      <div className="row">
        <button type="submit" disabled={save.isPending || conflict || !dirty}>
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
        <span className="muted">Version {base.version}</span>
      </div>
    </form>
  );
}
