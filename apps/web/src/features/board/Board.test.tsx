import type { BoardDto } from '@dpp/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { errorBody, makeBoard, type createFakeFetch } from '../../test/fakeBackend';

type FakeBackend = ReturnType<typeof createFakeFetch>;
import { renderApp } from '../../test/renderApp';

const boardPath = /^\/projects\/[^/]+\/board$/;

function renderBoard(board: BoardDto, extra?: (backend: FakeBackend) => void) {
  return renderApp(`/projects/${board.project.id}`, {
    routes: (b) => {
      b.on('GET', boardPath, () => ({ status: 200, body: board }));
      extra?.(b);
    },
  });
}

function columnRegion(name: string) {
  return screen.getByRole('region', { name: new RegExp(`^${name}`) });
}

describe('board', () => {
  it('renders columns with tasks in server order and empty columns explicitly', async () => {
    const board = makeBoard([['First', 'Second', 'Third'], [], ['Shipped']]);
    renderBoard(board);

    expect(await screen.findByRole('heading', { name: 'Launch' })).toBeInTheDocument();
    const todo = within(columnRegion('To Do'));
    expect(
      todo.getAllByRole('listitem').map((li) => li.querySelector('.task-title')?.textContent),
    ).toEqual(['First', 'Second', 'Third']);
    expect(within(columnRegion('In Progress')).getByText('No tasks yet')).toBeInTheDocument();
  });

  it('moves a task by sending its version and an anchor, then refetches the board', async () => {
    const board = makeBoard([['A'], ['X', 'Y'], []]);
    const task = board.columns[0]!.tasks[0]!;
    const t = renderBoard(board, (b) =>
      b.on('POST', /\/move$/, () => ({ status: 200, body: { ...task, version: 2 } })),
    );
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Launch' });

    await user.selectOptions(screen.getByLabelText('Move A to column'), 'In Progress');

    await waitFor(() => expect(t.backend.callsTo('POST', /\/move$/)).toHaveLength(1));
    expect(t.backend.callsTo('POST', /\/move$/)[0]!.body).toEqual({
      expectedVersion: 1,
      columnId: board.columns[1]!.id,
      afterTaskId: board.columns[1]!.tasks[1]!.id,
    });
    await waitFor(() => expect(t.backend.callsTo('GET', boardPath)).toHaveLength(2));
  });

  it('reports a conflicting move and refreshes instead of retrying', async () => {
    const board = makeBoard([['A', 'B']]);
    const t = renderBoard(board, (b) =>
      b.on('POST', /\/move$/, () => ({
        status: 409,
        body: errorBody('VERSION_CONFLICT', 'modified', { currentVersion: 3 }),
      })),
    );
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Launch' });

    await user.click(screen.getByRole('button', { name: 'Move A down' }));

    expect(await screen.findByText(/changed by someone else/i)).toBeInTheDocument();
    await waitFor(() => expect(t.backend.callsTo('GET', boardPath)).toHaveLength(2));
    expect(t.backend.callsTo('POST', /\/move$/)).toHaveLength(1);
  });

  it('shows a temporary-unavailability state with retry on 503', async () => {
    const board = makeBoard([['A']]);
    let up = false;
    renderApp(`/projects/${board.project.id}`, {
      routes: (b) =>
        b.on('GET', boardPath, () =>
          up
            ? { status: 200, body: board }
            : {
                status: 503,
                body: errorBody('DEPENDENCY_UNAVAILABLE', 'Service temporarily unavailable'),
              },
        ),
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/temporarily unavailable/i);
    up = true;
    await userEvent.setup().click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Launch' })).toBeInTheDocument();
  });

  it('keeps the last loaded board visible when a refresh fails', async () => {
    const board = makeBoard([['Still here']]);
    let fail = false;
    renderApp(`/projects/${board.project.id}`, {
      routes: (b) =>
        b.on('GET', boardPath, () =>
          fail
            ? { status: 503, body: errorBody('DEPENDENCY_UNAVAILABLE', 'down') }
            : { status: 200, body: board },
        ),
    });
    await screen.findByText('Still here');
    fail = true;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh' }));

    expect(await screen.findByText(/as last loaded/i)).toBeInTheDocument();
    expect(screen.getByText('Still here')).toBeInTheDocument();
  });

  it('explains 403 and offers a way out', async () => {
    const board = makeBoard([]);
    renderApp(`/projects/${board.project.id}`, {
      routes: (b) =>
        b.on('GET', boardPath, () => ({ status: 403, body: errorBody('FORBIDDEN', 'no') })),
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(/permission/i);
    expect(screen.getByRole('link', { name: 'Back to workspaces' })).toBeInTheDocument();
  });

  it('handles a task deleted by someone else', async () => {
    const board = makeBoard([['Gone soon']]);
    const task = board.columns[0]!.tasks[0]!;
    renderApp(`/projects/${board.project.id}/tasks/${task.id}`, {
      routes: (b) => {
        b.on('GET', boardPath, () => ({ status: 200, body: board }));
        b.on('GET', /^\/tasks\/[^/]+$/, () => ({
          status: 404,
          body: errorBody('NOT_FOUND', 'Task not found'),
        }));
      },
    });
    expect(await screen.findByText(/no longer exists/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to board' })).toBeInTheDocument();
  });
});
