import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, NavLink, Outlet, useLocation, useMatch } from 'react-router';
import { Avatar, toneFor } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import { useApi, useSession } from '../../lib/AppProviders';
import { queryKeys } from '../../lib/query/keys';

/** Gate for every signed-in route. Without a token, go to login and come back afterwards. */
export function AppLayout() {
  const { token } = useSession();
  const location = useLocation();
  if (!token) {
    const returnTo = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?returnTo=${returnTo}`} replace />;
  }
  return <SignedInShell />;
}

/**
 * Which workspace/project the current page is about, from the URL (and, on a project page,
 * the board query the page itself runs: same key, so no extra request).
 */
function useRouteContext() {
  const api = useApi();
  const workspaceMatch = useMatch('/workspaces/:workspaceId/*');
  const projectMatch = useMatch('/projects/:projectId/*');
  const projectId = projectMatch?.params.projectId;
  const board = useQuery({
    queryKey: queryKeys.board(projectId ?? ''),
    queryFn: ({ signal }) => api.getBoard(projectId!, signal),
    enabled: projectId !== undefined,
  });
  const workspaceId = workspaceMatch?.params.workspaceId ?? board.data?.project.workspaceId;
  const workspace = useQuery({
    queryKey: queryKeys.workspace(workspaceId ?? ''),
    queryFn: ({ signal }) => api.getWorkspace(workspaceId!, signal),
    enabled: workspaceId !== undefined,
  });
  return { workspaceId, workspace: workspace.data, project: board.data?.project };
}

function SignedInShell() {
  const api = useApi();
  const { store } = useSession();
  const queryClient = useQueryClient();
  // Validates the stored token with the server; a 401 here ends the session via the client.
  // Other failures only hide the name: the page below reports outages with its own retry, and
  // a second notice for the same outage would just compete with it.
  const me = useQuery({ queryKey: queryKeys.me(), queryFn: ({ signal }) => api.me(signal) });
  const context = useRouteContext();

  const signOut = () => {
    store.end('signed_out');
    queryClient.clear();
  };

  return (
    <div className="shell">
      <Sidebar {...context} />
      <div className="shell-main">
        <header className="topbar">
          <nav aria-label="Breadcrumb" className="breadcrumbs">
            <Icon name="chevronRight" size={14} />
            <Link to="/workspaces">Workspaces</Link>
            {context.workspace && (
              <>
                <Icon name="chevronRight" size={14} />
                {context.project ? (
                  <Link to={`/workspaces/${context.workspace.id}`}>{context.workspace.name}</Link>
                ) : (
                  <span aria-current="page">{context.workspace.name}</span>
                )}
              </>
            )}
            {context.project && (
              <>
                <Icon name="chevronRight" size={14} />
                <span aria-current="page">{context.project.name}</span>
              </>
            )}
          </nav>
          <span className="spacer" />
          {me.data ? (
            <details className="user-menu">
              <summary>
                <Avatar id={me.data.id} name={me.data.displayName} size={34} />
                <span className="user-name">{me.data.displayName}</span>
                <Icon name="chevronDown" size={16} />
              </summary>
              <div className="menu">
                <p className="menu-label">{me.data.email}</p>
                <button type="button" onClick={signOut}>
                  <Icon name="logout" size={16} /> Sign out
                </button>
              </div>
            </details>
          ) : (
            <button type="button" className="btn btn-ghost" onClick={signOut}>
              Sign out
            </button>
          )}
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function Sidebar({ workspaceId, project }: ReturnType<typeof useRouteContext>) {
  const api = useApi();
  const projects = useQuery({
    queryKey: queryKeys.workspaceProjects(workspaceId ?? ''),
    queryFn: ({ signal }) => api.listProjects(workspaceId!, signal),
    enabled: workspaceId !== undefined,
  });
  const navClass = ({ isActive }: { isActive: boolean }) =>
    isActive ? 'side-link active' : 'side-link';

  return (
    <aside className="sidebar" aria-label="Main navigation">
      <Link to="/workspaces" className="brand">
        <span className="brand-mark">
          <Icon name="logo" size={18} />
        </span>
        Project Platform
      </Link>

      {workspaceId ? (
        <nav className="side-nav" aria-label="Workspace">
          <Link to="/workspaces" className="side-link">
            <Icon name="arrowLeft" /> Workspaces
          </Link>
          <NavLink to={`/workspaces/${workspaceId}`} end className={navClass}>
            <Icon name="home" /> Overview
          </NavLink>
          <Link
            to={`/workspaces/${workspaceId}#projects`}
            className={project ? 'side-link active' : 'side-link'}
          >
            <Icon name="projects" /> Projects
          </Link>
          <Link to={`/workspaces/${workspaceId}#members`} className="side-link">
            <Icon name="users" /> Members
          </Link>
        </nav>
      ) : (
        <nav className="side-nav" aria-label="Workspaces">
          <NavLink to="/workspaces" className={navClass}>
            <Icon name="home" /> Workspaces
          </NavLink>
        </nav>
      )}

      {workspaceId && (
        <section className="side-projects" aria-labelledby="side-projects-heading">
          <div className="side-heading">
            <h2 id="side-projects-heading">Your projects</h2>
            <Link
              to={`/workspaces/${workspaceId}#projects`}
              className="icon-button"
              aria-label="New project"
              title="New project"
            >
              <Icon name="plus" size={16} />
            </Link>
          </div>
          <ul>
            {projects.data?.map((p) => (
              <li key={p.id}>
                <NavLink to={`/projects/${p.id}`} className={navClass}>
                  <span className="dot" style={{ background: toneFor(p.id) }} aria-hidden="true" />
                  {p.name}
                </NavLink>
              </li>
            ))}
            {projects.data?.length === 0 && <li className="muted small side-empty">None yet</li>}
          </ul>
        </section>
      )}
    </aside>
  );
}
