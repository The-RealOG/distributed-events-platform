import { QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { NoticesProvider } from '../components/Notices';
import { AppProviders } from '../lib/AppProviders';
import { createSessionStore } from '../lib/auth/sessionStore';
import { createApiForSession } from '../lib/bootstrap';
import { routes } from '../routes';
import { createFakeFetch, USER } from './fakeBackend';

/** Renders the real app (routes, providers, API client) against a fake network. */
export function renderApp(
  path: string,
  options: {
    signedIn?: boolean;
    /** Register routes before the first render; initial queries fire during render. */
    routes?: (backend: ReturnType<typeof createFakeFetch>) => void;
  } = {},
) {
  const backend = createFakeFetch();
  backend.on('GET', /^\/me$/, () => ({ status: 200, body: USER }));
  options.routes?.(backend);

  if (options.signedIn !== false) localStorage.setItem('dpp.session.token', 'test-token');
  const session = createSessionStore(localStorage);
  // Retries are exercised separately (queryClient.test.ts); here they'd only slow tests down.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const api = createApiForSession('http://gateway.test/api', session, queryClient, backend.fetch);
  const router = createMemoryRouter(routes, { initialEntries: [path] });

  const utils = render(
    <AppProviders api={api} session={session} queryClient={queryClient}>
      <NoticesProvider>
        <RouterProvider router={router} />
      </NoticesProvider>
    </AppProviders>,
  );
  return { ...utils, backend, session, router, queryClient };
}
