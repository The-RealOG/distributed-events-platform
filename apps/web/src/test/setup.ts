import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// findBy*/waitFor still wait for an observable condition; the default 1 s ceiling was too
// short for a heavily loaded machine, where rendering alone can take longer.
configure({ asyncUtilTimeout: 10_000 });

afterEach(() => {
  cleanup();
  localStorage.clear();
});

// Component tests never open real sockets: an inert WebSocket that stays "connecting".
// Realtime behaviour is covered by lib/realtime tests with their own fake.
class InertWebSocket {
  onopen: unknown = null;
  onmessage: unknown = null;
  onclose: unknown = null;
  readonly readyState = 0;
  send(): void {}
  close(): void {}
}
globalThis.WebSocket = InertWebSocket as unknown as typeof WebSocket;
