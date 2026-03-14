import { describe, expect, it, vi } from 'vitest';
import { createSessionStore } from './sessionStore';

describe('session store', () => {
  it('persists the token and restores it on the next load', () => {
    createSessionStore(localStorage).signIn('abc');
    expect(createSessionStore(localStorage).get()).toEqual({ token: 'abc', endedBecause: null });
  });

  it('records why a session ended and notifies subscribers', () => {
    const store = createSessionStore(localStorage);
    store.signIn('abc');
    const listener = vi.fn();
    store.subscribe(listener);
    store.end('expired');
    expect(store.get()).toEqual({ token: null, endedBecause: 'expired' });
    expect(localStorage.getItem('dpp.session.token')).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps working when storage throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    } as unknown as Storage;
    const store = createSessionStore(broken);
    store.signIn('abc');
    expect(store.get().token).toBe('abc');
  });
});
