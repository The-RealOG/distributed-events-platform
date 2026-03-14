import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { NoticesProvider } from './components/Notices';
import { config } from './config';
import { AppProviders } from './lib/AppProviders';
import { createSessionStore } from './lib/auth/sessionStore';
import { createApiForSession } from './lib/bootstrap';
import { createQueryClient } from './lib/query/queryClient';
import { routes } from './routes';
import './styles.css';

const session = createSessionStore();
const queryClient = createQueryClient();
const api = createApiForSession(config.apiBaseUrl, session, queryClient);
const router = createBrowserRouter(routes);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProviders api={api} session={session} queryClient={queryClient}>
      <NoticesProvider>
        <RouterProvider router={router} />
      </NoticesProvider>
    </AppProviders>
  </StrictMode>,
);
