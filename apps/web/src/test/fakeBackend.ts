import type { BoardDto, TaskDto } from '@dpp/contracts';

export interface RecordedCall {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

type Handler = (call: RecordedCall, match: RegExpMatchArray) => { status: number; body?: unknown };

export const urlOf = (input: RequestInfo | URL): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

/**
 * A fake `fetch` at the network boundary: tests exercise the real API client, query cache,
 * router and components, and assert on exactly what was sent.
 */
export function createFakeFetch() {
  const routes: { method: string; pattern: RegExp; handler: Handler }[] = [];
  const calls: RecordedCall[] = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(urlOf(input));
    const path = url.pathname.replace(/^\/api/, '') + url.search;
    const method = init?.method ?? 'GET';
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>),
    );
    const call: RecordedCall = {
      method,
      path,
      headers,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    };
    calls.push(call);
    for (const route of [...routes].reverse()) {
      const match = route.method === method ? path.match(route.pattern) : null;
      if (match) {
        const { status, body } = route.handler(call, match);
        return new Response(body === undefined ? null : JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      }
    }
    return new Response(JSON.stringify(errorBody('NOT_FOUND', 'Route not found')), { status: 404 });
  };

  return {
    fetch: fetchImpl,
    calls,
    /** Later registrations take precedence, so a test can override a default. */
    on(method: string, pattern: RegExp, handler: Handler) {
      routes.push({ method, pattern, handler });
    },
    callsTo(method: string, pattern: RegExp) {
      return calls.filter((c) => c.method === method && pattern.test(c.path));
    },
  };
}

export const errorBody = (code: string, message: string, details?: Record<string, unknown>) => ({
  error: { code, message, ...(details ? { details } : {}), requestId: 'req-test' },
});

let counter = 0;
export const uuid = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

export const USER = { id: uuid(), email: 'ada@example.com', displayName: 'Ada' };
export const OTHER_USER = { id: uuid(), email: 'bob@example.com', displayName: 'Bob' };

export function makeTask(
  overrides: Partial<TaskDto> & Pick<TaskDto, 'columnId' | 'projectId'>,
): TaskDto {
  return {
    id: uuid(),
    title: 'Task',
    description: '',
    position: '1024',
    version: 1,
    createdBy: USER.id,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    assigneeIds: [],
    ...overrides,
  };
}

export function makeBoard(taskTitlesByColumn: string[][]): BoardDto {
  const projectId = uuid();
  const workspaceId = uuid();
  const names = ['To Do', 'In Progress', 'Done'];
  return {
    project: {
      id: projectId,
      workspaceId,
      name: 'Launch',
      description: '',
      createdBy: USER.id,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    board: { id: uuid(), name: 'Launch' },
    columns: names.map((name, i) => {
      const columnId = uuid();
      return {
        id: columnId,
        name,
        position: String((i + 1) * 1024),
        tasks: (taskTitlesByColumn[i] ?? []).map((title, j) =>
          makeTask({ columnId, projectId, title, position: String((j + 1) * 1024) }),
        ),
      };
    }),
  };
}
