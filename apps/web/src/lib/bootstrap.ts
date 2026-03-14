import type { QueryClient } from '@tanstack/react-query';
import { ApiClient } from './api/client';
import { createApi } from './api/endpoints';
import type { SessionStore } from './auth/sessionStore';

/** Wires the API client to the session: any 401 ends the session and drops cached data. */
export function createApiForSession(
  baseUrl: string,
  session: SessionStore,
  queryClient: QueryClient,
  fetchImpl?: typeof fetch,
) {
  const client = new ApiClient({
    baseUrl,
    getToken: () => session.get().token,
    onUnauthenticated: () => {
      if (session.get().token === null) return;
      session.end('expired');
      queryClient.clear();
    },
    ...(fetchImpl ? { fetchImpl } : {}),
  });
  return createApi(client);
}
