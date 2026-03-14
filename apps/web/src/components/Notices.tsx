import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

interface Notice {
  id: number;
  tone: 'info' | 'error';
  message: string;
}

const NoticesContext = createContext<((tone: Notice['tone'], message: string) => void) | null>(
  null,
);

/** Transient messages for outcomes that happen away from a form (e.g. a move that conflicted). */
export function NoticesProvider({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const notify = useCallback((tone: Notice['tone'], message: string) => {
    const id = Date.now() + Math.random();
    setNotices((current) => [...current.slice(-2), { id, tone, message }]);
    setTimeout(() => setNotices((current) => current.filter((n) => n.id !== id)), 8_000);
  }, []);
  const value = useMemo(() => notify, [notify]);

  return (
    <NoticesContext.Provider value={value}>
      {children}
      <div className="notices" aria-live="polite">
        {notices.map((notice) => (
          <div
            key={notice.id}
            className={`notice ${notice.tone === 'error' ? 'notice-error' : 'notice-info'}`}
            role={notice.tone === 'error' ? 'alert' : 'status'}
          >
            {notice.message}
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setNotices((current) => current.filter((n) => n.id !== notice.id))}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </NoticesContext.Provider>
  );
}

export function useNotify() {
  const notify = useContext(NoticesContext);
  if (!notify) throw new Error('NoticesProvider is missing');
  return notify;
}
