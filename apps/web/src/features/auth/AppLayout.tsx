import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, Outlet, useLocation } from 'react-router';
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

function SignedInShell() {
  const api = useApi();
  const { store } = useSession();
  const queryClient = useQueryClient();
  // Validates the stored token with the server; a 401 here ends the session via the client.
  // Other failures only hide the name: the page below reports outages with its own retry, and
  // a second notice for the same outage would just compete with it.
  const me = useQuery({ queryKey: queryKeys.me(), queryFn: ({ signal }) => api.me(signal) });

  const signOut = () => {
    store.end('signed_out');
    queryClient.clear();
  };

  return (
    <div className="app">
      <header className="app-header">
        <Link to="/workspaces" className="brand">
          Project Platform
        </Link>
        <span className="spacer" />
        {me.data && <span className="muted">{me.data.displayName}</span>}
        <button type="button" onClick={signOut}>
          Sign out
        </button>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
