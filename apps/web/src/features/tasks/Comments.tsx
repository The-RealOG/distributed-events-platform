import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ErrorNotice, Loading } from '../../components/ErrorNotice';
import { describeError } from '../../lib/api/errors';
import { useApi } from '../../lib/AppProviders';
import { queryKeys } from '../../lib/query/keys';

export function Comments({ taskId }: { taskId: string }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  const comments = useQuery({
    queryKey: queryKeys.taskComments(taskId),
    queryFn: ({ signal }) => api.listComments(taskId, signal),
  });
  const add = useMutation({
    mutationFn: () => api.addComment(taskId, body.trim()),
    onSuccess: () => {
      setBody('');
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskComments(taskId) });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!add.isPending) add.mutate();
  };

  return (
    <section className="stack" aria-labelledby="comments-heading">
      <h3 id="comments-heading">Comments</h3>
      {comments.isPending && <Loading label="Loading comments" />}
      {comments.isError && (
        <ErrorNotice error={comments.error} onRetry={() => void comments.refetch()} />
      )}
      {comments.data?.length === 0 && <p className="muted">No comments yet.</p>}
      {comments.data && comments.data.length > 0 && (
        <ol className="comments">
          {comments.data.map((c) => (
            <li key={c.id}>
              <strong>{c.authorDisplayName}</strong>{' '}
              <time className="muted" dateTime={c.createdAt}>
                {new Date(c.createdAt).toLocaleString()}
              </time>
              <p>{c.body}</p>
            </li>
          ))}
        </ol>
      )}
      <form onSubmit={submit} className="stack" aria-label="Add comment">
        <label>
          Comment
          <textarea
            required
            rows={2}
            maxLength={10_000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        <button type="submit" disabled={add.isPending}>
          {add.isPending ? 'Posting…' : 'Post comment'}
        </button>
        {add.isError && (
          <p role="alert" className="notice notice-error">
            {describeError(add.error)}
          </p>
        )}
      </form>
    </section>
  );
}
