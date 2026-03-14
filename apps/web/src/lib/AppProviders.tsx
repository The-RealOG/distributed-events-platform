import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { Api } from './api/endpoints';
import type { SessionSnapshot, SessionStore } from './auth/sessionStore';

interface AppServices {
  api: Api;
  session: SessionStore;
}

const ServicesContext = createContext<AppServices | null>(null);

export function AppProviders({
  api,
  session,
  queryClient,
  children,
}: AppServices & { queryClient: QueryClient; children: ReactNode }) {
  return (
    <ServicesContext.Provider value={{ api, session }}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ServicesContext.Provider>
  );
}

function useServices(): AppServices {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('AppProviders is missing');
  return services;
}

export const useApi = (): Api => useServices().api;

export function useSession(): SessionSnapshot & { store: SessionStore } {
  const { session } = useServices();
  const snapshot = useSyncExternalStore(session.subscribe, session.get);
  return { ...snapshot, store: session };
}
