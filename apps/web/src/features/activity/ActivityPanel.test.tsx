import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { errorBody, makeBoard, USER, uuid } from '../../test/fakeBackend';
import { renderApp } from '../../test/renderApp';

const boardPath = /^\/projects\/[^/]+\/board$/;
const activityPath = /^\/projects\/[^/]+\/activity/;

function entry(eventType: string, data: Record<string, unknown>, id: string) {
  return {
    id,
    eventId: uuid(),
    eventType,
    taskId: uuid(),
    actorId: USER.id,
    data,
    occurredAt: '2026-09-26T10:00:00.000Z',
    correlationId: 'c',
  };
}

describe('activity panel', () => {
  it('shows the project’s history in words, newest first, and pages to older entries', async () => {
    const board = makeBoard([['Spec'], [], []]);
    const [todo, doing] = [board.columns[0]!.id, board.columns[1]!.id];
    renderApp(`/projects/${board.project.id}`, {
      routes: (b) => {
        b.on('GET', boardPath, () => ({ status: 200, body: board }));
        b.on('GET', activityPath, (call) =>
          call.path.includes('before=')
            ? {
                status: 200,
                body: {
                  items: [entry('task.created', { title: 'Spec', columnId: todo }, '1')],
                  nextCursor: null,
                  people: { [USER.id]: 'Ada' },
                },
              }
            : {
                status: 200,
                body: {
                  items: [
                    entry(
                      'task.moved',
                      { title: 'Spec', fromColumnId: todo, toColumnId: doing },
                      '2',
                    ),
                  ],
                  nextCursor: '2',
                  people: { [USER.id]: 'Ada' },
                },
              },
        );
      },
    });
    const panel = await screen.findByRole('complementary', { name: 'Activity' });
    expect(
      await within(panel).findByRole('listitem', {
        name: 'Ada moved “Spec” from “To Do” to “In Progress”',
      }),
    ).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'Show older' }));
    expect(
      await within(panel).findByRole('listitem', { name: 'Ada created “Spec” in “To Do”' }),
    ).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Show older' })).not.toBeInTheDocument();
  });

  it('says when there is no activity yet', async () => {
    const board = makeBoard([[], [], []]);
    renderApp(`/projects/${board.project.id}`, {
      routes: (b) => {
        b.on('GET', boardPath, () => ({ status: 200, body: board }));
        b.on('GET', activityPath, () => ({
          status: 200,
          body: { items: [], nextCursor: null, people: {} },
        }));
      },
    });
    expect(await screen.findByText('No activity yet.')).toBeInTheDocument();
  });

  it('an activity failure stays in the panel: the board still works', async () => {
    const board = makeBoard([['Still here'], [], []]);
    renderApp(`/projects/${board.project.id}`, {
      routes: (b) => {
        b.on('GET', boardPath, () => ({ status: 200, body: board }));
        b.on('GET', activityPath, () => ({
          status: 503,
          body: errorBody('DEPENDENCY_UNAVAILABLE', 'down'),
        }));
      },
    });
    expect(await screen.findByText('Still here')).toBeInTheDocument();
    const panel = await screen.findByRole('complementary', { name: 'Activity' });
    expect(await within(panel).findByRole('alert')).toBeInTheDocument();
  });
});
