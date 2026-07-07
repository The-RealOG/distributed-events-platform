import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Avatar, toneFor } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import { ErrorNotice, Loading } from '../../components/ErrorNotice';
import { describeError, isApiError } from '../../lib/api/errors';
import { useApi } from '../../lib/AppProviders';
import { queryKeys } from '../../lib/query/keys';

export function WorkspacePage() {
  const { workspaceId = '' } = useParams();
  const api = useApi();
  const workspace = useQuery({
    queryKey: queryKeys.workspace(workspaceId),
    queryFn: ({ signal }) => api.getWorkspace(workspaceId, signal),
  });

  if (workspace.isPending) return <Loading label="Loading workspace" />;
  if (workspace.isError) {
    return <ErrorNotice error={workspace.error} onRetry={() => void workspace.refetch()} />;
  }
  // The role only shapes what the UI offers; the server enforces every permission.
  const canManage = workspace.data.role === 'OWNER' || workspace.data.role === 'ADMIN';

  return (
    <section className="page">
      <div className="page-header">
        <div>
          <h1>
            {workspace.data.name} <span className="badge">{workspace.data.role}</span>
          </h1>
          <p className="muted">Projects and people in this workspace.</p>
        </div>
      </div>
      <Projects workspaceId={workspaceId} canCreate={canManage} />
      <Members
        workspaceId={workspaceId}
        grantable={
          workspace.data.role === 'OWNER' ? ['MEMBER', 'ADMIN'] : canManage ? ['MEMBER'] : []
        }
      />
    </section>
  );
}

function Projects({ workspaceId, canCreate }: { workspaceId: string; canCreate: boolean }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const projects = useQuery({
    queryKey: queryKeys.workspaceProjects(workspaceId),
    queryFn: ({ signal }) => api.listProjects(workspaceId, signal),
  });
  const create = useMutation({
    mutationFn: () => api.createProject(workspaceId, name.trim()),
    onSuccess: (project) => {
      setName('');
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaceProjects(workspaceId) });
      void navigate(`/projects/${project.id}`);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!create.isPending) create.mutate();
  };

  return (
    <section className="stack" id="projects">
      <h2 className="section-title">Projects</h2>
      {projects.isPending && <Loading label="Loading projects" />}
      {projects.isError && (
        <ErrorNotice error={projects.error} onRetry={() => void projects.refetch()} />
      )}
      {projects.data?.length === 0 && <p className="muted">No projects yet.</p>}
      {projects.data && projects.data.length > 0 && (
        <ul className="card-grid">
          {projects.data.map((p) => (
            <li key={p.id}>
              <Link to={`/projects/${p.id}`} className="card tile">
                <span className="tile-mark" style={{ background: toneFor(p.id) }}>
                  <Icon name="board" size={18} />
                </span>
                <span className="tile-body">
                  <span className="tile-title">{p.name}</span>
                  {p.description && <span className="muted small">{p.description}</span>}
                </span>
                <Icon name="chevronRight" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {canCreate ? (
        <form onSubmit={submit} className="card inline-form" aria-label="Create project">
          <label>
            New project name
            <input
              required
              maxLength={200}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create project'}
          </button>
        </form>
      ) : (
        <p className="muted">Only workspace owners and admins can create projects.</p>
      )}
      {create.isError && (
        <p role="alert" className="notice notice-error">
          {describeError(create.error)}
        </p>
      )}
    </section>
  );
}

function Members({
  workspaceId,
  grantable,
}: {
  workspaceId: string;
  grantable: ('ADMIN' | 'MEMBER')[];
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'ADMIN' | 'MEMBER'>('MEMBER');
  const members = useQuery({
    queryKey: queryKeys.workspaceMembers(workspaceId),
    queryFn: ({ signal }) => api.listMembers(workspaceId, signal),
  });
  const add = useMutation({
    mutationFn: () => api.addMember(workspaceId, email.trim(), role),
    onSuccess: () => {
      setEmail('');
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaceMembers(workspaceId) });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!add.isPending) add.mutate();
  };

  return (
    <section className="stack" id="members">
      <h2 className="section-title">Members</h2>
      {members.isPending && <Loading label="Loading members" />}
      {members.isError && (
        <ErrorNotice error={members.error} onRetry={() => void members.refetch()} />
      )}
      {members.data && (
        <ul className="card member-list">
          {members.data.map((m) => (
            <li key={m.userId}>
              <Avatar id={m.userId} name={m.displayName} size={32} />
              <span className="member-body">
                <span className="member-name">{m.displayName}</span>
                <span className="muted small">{m.email}</span>
              </span>
              <span className="badge">{m.role}</span>
            </li>
          ))}
        </ul>
      )}
      {grantable.length > 0 && (
        <form onSubmit={submit} className="card inline-form" aria-label="Add member">
          <label>
            Member email
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            Role
            <select value={role} onChange={(e) => setRole(e.target.value as 'ADMIN' | 'MEMBER')}>
              {grantable.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn btn-primary" disabled={add.isPending}>
            {add.isPending ? 'Adding…' : 'Add member'}
          </button>
        </form>
      )}
      {add.isError && (
        <p role="alert" className="notice notice-error">
          {isApiError(add.error, 'not_found')
            ? 'No account with that email. They need to sign in once before they can be added.'
            : describeError(add.error)}
        </p>
      )}
    </section>
  );
}
