import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { config } from '../../config';
import { describeError } from '../../lib/api/errors';
import { useApi, useSession } from '../../lib/AppProviders';
import { Icon } from '../../components/Icon';

function safeReturnPath(value: string | null): string {
  // Only same-app paths; never redirect to another origin after login.
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/workspaces';
}

export function LoginPage({
  devLoginEnabled = config.devLoginEnabled,
}: {
  devLoginEnabled?: boolean;
}) {
  const api = useApi();
  const { token, endedBecause, store } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnTo = safeReturnPath(params.get('returnTo'));
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');

  const login = useMutation({
    mutationFn: () => api.devLogin(email.trim(), displayName.trim()),
    onSuccess: ({ token: newToken }) => {
      store.signIn(newToken);
      void navigate(returnTo, { replace: true });
    },
  });

  if (token) return <Navigate to={returnTo} replace />;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!login.isPending) login.mutate();
  };

  return (
    <main className="login card">
      <div className="login-brand">
        <span className="brand-mark">
          <Icon name="logo" size={20} />
        </span>
        Project Platform
      </div>
      <h1>Sign in</h1>
      {endedBecause === 'expired' && (
        <p role="alert" className="notice notice-info">
          Your session ended. Please sign in again.
        </p>
      )}
      {devLoginEnabled ? (
        <form onSubmit={submit} className="stack">
          <p className="muted">
            Development login: no password; the account is created on first use.
          </p>
          <label>
            Email
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Display name
            <input
              required
              maxLength={100}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </label>
          {login.isError && (
            <p role="alert" className="notice notice-error">
              {describeError(login.error)}
            </p>
          )}
          <button type="submit" className="btn btn-primary btn-block" disabled={login.isPending}>
            {login.isPending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      ) : (
        <p className="notice notice-info">No sign-in method is configured for this environment.</p>
      )}
    </main>
  );
}
