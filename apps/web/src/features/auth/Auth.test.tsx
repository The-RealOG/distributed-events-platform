import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { errorBody, USER } from '../../test/fakeBackend';
import { renderApp } from '../../test/renderApp';

describe('authentication', () => {
  it('sends signed-out users to login and returns them to where they were going', async () => {
    const t = renderApp('/workspaces', {
      signedIn: false,
      routes: (b) => {
        b.on('POST', /^\/auth\/dev-login$/, () => ({
          status: 200,
          body: { token: 'new-token', user: USER },
        }));
        b.on('GET', /^\/workspaces$/, () => ({ status: 200, body: [] }));
      },
    });
    // The redirect is a navigation, which the router may commit asynchronously.
    await waitFor(() => expect(t.router.state.location.pathname).toBe('/login'));
    expect(t.router.state.location.search).toBe('?returnTo=%2Fworkspaces');

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Display name'), 'Ada');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'Workspaces' })).toBeInTheDocument();
    expect(t.router.state.location.pathname).toBe('/workspaces');
    // The token from the server is used as-is on later requests; the UI never decodes it.
    const list = t.backend.callsTo('GET', /^\/workspaces$/);
    expect(list.at(-1)!.headers['authorization']).toBe('Bearer new-token');
  });

  it('ends the session on 401 and explains why on the login page', async () => {
    const t = renderApp('/workspaces', {
      routes: (b) => {
        b.on('GET', /^\/workspaces$/, () => ({
          status: 401,
          body: errorBody('TOKEN_EXPIRED', 'Token expired'),
        }));
      },
    });

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByText(/session ended/i)).toBeInTheDocument();
    expect(t.session.get().token).toBeNull();
    expect(localStorage.getItem('dpp.session.token')).toBeNull();
    await waitFor(() => expect(t.router.state.location.search).toContain('returnTo'));
  });

  it('ignores off-site returnTo targets after login', async () => {
    const t = renderApp('/login?returnTo=//evil.example/steal', {
      signedIn: false,
      routes: (b) => {
        b.on('POST', /^\/auth\/dev-login$/, () => ({
          status: 200,
          body: { token: 't', user: USER },
        }));
        b.on('GET', /^\/workspaces$/, () => ({ status: 200, body: [] }));
      },
    });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Display name'), 'Ada');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(t.router.state.location.pathname).toBe('/workspaces'));
  });
});

describe('login availability', () => {
  it('offers no login form when dev login is not enabled', async () => {
    const { LoginPage } = await import('./LoginPage');
    const { render } = await import('@testing-library/react');
    const { createMemoryRouter, RouterProvider } = await import('react-router');
    const { AppProviders } = await import('../../lib/AppProviders');
    const { createSessionStore } = await import('../../lib/auth/sessionStore');
    const { createApiForSession } = await import('../../lib/bootstrap');
    const { QueryClient } = await import('@tanstack/react-query');

    const session = createSessionStore(localStorage);
    const queryClient = new QueryClient();
    const api = createApiForSession('http://x/api', session, queryClient, () =>
      Promise.reject(new Error()),
    );
    const router = createMemoryRouter(
      [{ path: '/login', element: <LoginPage devLoginEnabled={false} /> }],
      {
        initialEntries: ['/login'],
      },
    );
    render(
      <AppProviders api={api} session={session} queryClient={queryClient}>
        <RouterProvider router={router} />
      </AppProviders>,
    );
    expect(await screen.findByText(/no sign-in method/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
  });
});
