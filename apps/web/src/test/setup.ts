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
