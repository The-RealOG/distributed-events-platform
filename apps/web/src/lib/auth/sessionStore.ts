export type SessionEndReason = 'expired' | 'signed_out';

export interface SessionSnapshot {
  token: string | null;
  /** Why the last session ended, so the login page can say so. */
  endedBecause: SessionEndReason | null;
}

// Function-valued properties (not methods) so they can be passed around unbound,
// e.g. to useSyncExternalStore.
export interface SessionStore {
  get: () => SessionSnapshot;
  signIn: (token: string) => void;
  end: (reason: SessionEndReason) => void;
  subscribe: (listener: () => void) => () => void;
}

const KEY = 'dpp.session.token';

/**
 * Holds the bearer token outside React so the API client can read it synchronously.
 * Persisted in localStorage for local development only: a production identity provider
 * would use httpOnly cookies or an in-memory token with refresh (see docs/architecture.md).
 * The token is opaque here; the UI never decodes it for identity or permissions.
 */
export function createSessionStore(
  storage: Storage | undefined = globalThis.localStorage,
): SessionStore {
  const read = (): string | null => {
    try {
      return storage?.getItem(KEY) ?? null;
    } catch {
      return null;
    }
  };
  const write = (token: string | null) => {
    try {
      if (token) storage?.setItem(KEY, token);
      else storage?.removeItem(KEY);
    } catch {
      // Storage may be unavailable (private mode); the session then lasts for this tab only.
    }
  };

  let snapshot: SessionSnapshot = { token: read(), endedBecause: null };
  const listeners = new Set<() => void>();
  const set = (next: SessionSnapshot) => {
    snapshot = next;
    write(next.token);
    listeners.forEach((listener) => listener());
  };

  return {
    get: () => snapshot,
    signIn: (token) => set({ token, endedBecause: null }),
    end: (reason) => {
      if (snapshot.token === null && snapshot.endedBecause === reason) return;
      set({ token: null, endedBecause: reason });
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
