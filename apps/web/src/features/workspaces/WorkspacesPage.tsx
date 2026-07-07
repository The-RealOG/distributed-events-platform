import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { toneFor } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import { ErrorNotice, Loading } from '../../components/ErrorNotice';
import { describeError } from '../../lib/api/errors';
import { useApi } from '../../lib/AppProviders';
import { queryKeys } from '../../lib/query/keys';

export function WorkspacesPage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState('');

  const workspaces = useQuery({
    queryKey: queryKeys.workspaces(),
    queryFn: ({ signal }) => api.listWorkspaces(signal),
  });
  const create = useMutation({
    mutationFn: () => api.createWorkspace(name.trim()),
    onSuccess: (workspace) => {
      setName('');
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces() });
      void navigate(`/workspaces/${workspace.id}`);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!create.isPending) create.mutate();
  };

  return (
    <section className="page">
      <div className="page-header">
        <div>
          <h1>Workspaces</h1>
          <p className="muted">Teams and the projects they share.</p>
        </div>
      </div>
      {workspaces.isPending && <Loading label="Loading workspaces" />}
      {workspaces.isError && (
        <ErrorNotice error={workspaces.error} onRetry={() => void workspaces.refetch()} />
      )}
      {workspaces.data?.length === 0 && (
        <p className="muted">You aren’t in any workspaces yet. Create one to get started.</p>
      )}
      {workspaces.data && workspaces.data.length > 0 && (
        <ul className="card-grid">
          {workspaces.data.map((ws) => (
            <li key={ws.id}>
              <Link to={`/workspaces/${ws.id}`} className="card tile">
                <span className="tile-mark" style={{ background: toneFor(ws.id) }}>
                  {ws.name.charAt(0).toUpperCase()}
                </span>
                <span className="tile-body">
                  <span className="tile-title">{ws.name}</span>
                  <span className="badge">{ws.role}</span>
                </span>
                <Icon name="chevronRight" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="card inline-form" aria-label="Create workspace">
        <label>
          New workspace name
          <input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button type="submit" className="btn btn-primary" disabled={create.isPending}>
          {create.isPending ? 'Creating…' : 'Create workspace'}
        </button>
      </form>
      {create.isError && (
        <p role="alert" className="notice notice-error">
          {describeError(create.error)}
        </p>
      )}
    </section>
  );
}
