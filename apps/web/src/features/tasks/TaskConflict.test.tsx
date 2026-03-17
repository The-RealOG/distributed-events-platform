import type { TaskDto } from '@dpp/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { type createFakeFetch, errorBody, makeBoard } from '../../test/fakeBackend';
import { renderApp } from '../../test/renderApp';

/**
 * Two logical clients against one authoritative server:
 * A opens task v4; B saves (server → v5); A saves with v4 and must get 409, see B's version,
 * keep their own text, and not have anything resubmitted on their behalf.
 */
function setup() {
  const board = makeBoard([['Original']]);
  const column = board.columns[0]!;
  let server: TaskDto = { ...column.tasks[0]!, version: 4 };
  column.tasks[0] = server;

  const view = renderApp(`/projects/${board.project.id}/tasks/${server.id}`, {
    routes: (backend) => registerRoutes(backend),
  });

  function registerRoutes(backend: ReturnType<typeof createFakeFetch>) {
    backend.on('GET', /^\/projects\/[^/]+\/board$/, () => ({
      status: 200,
      body: { ...board, columns: [{ ...column, tasks: [server] }, ...board.columns.slice(1)] },
    }));
    backend.on('GET', /^\/tasks\/[^/]+$/, () => ({ status: 200, body: server }));
    backend.on('GET', /^\/tasks\/[^/]+\/comments$/, () => ({ status: 200, body: [] }));
    backend.on('GET', /^\/workspaces\/[^/]+\/members$/, () => ({ status: 200, body: [] }));
    // The server's real rule: apply only if expectedVersion matches the current version.
    backend.on('PATCH', /^\/tasks\/[^/]+$/, (call) => {
      const body = call.body as { expectedVersion: number; title: string; description: string };
      if (body.expectedVersion !== server.version) {
        return {
          status: 409,
          body: errorBody('VERSION_CONFLICT', 'modified', { currentVersion: server.version }),
        };
      }
      server = {
        ...server,
        title: body.title,
        description: body.description,
        version: server.version + 1,
      };
      return { status: 200, body: server };
    });
  }

  const clientBSaves = (title: string) => {
    server = { ...server, title, version: server.version + 1 };
  };
  const patches = () => view.backend.callsTo('PATCH', /^\/tasks\//);
  const serverState = () => server;
  return { ...view, clientBSaves, patches, serverState };
}

async function openEditorAndType(title: string) {
  const user = userEvent.setup();
  const form = await screen.findByRole('form', { name: 'Edit task' });
  const input = within(form).getByLabelText('Title');
  expect(input).toHaveValue('Original');
  await user.clear(input);
  await user.type(input, title);
  return { user, form, input };
}

describe('stale edit (409 VERSION_CONFLICT)', () => {
  it('shows the conflict, refetches the winner, keeps the draft, and does not resubmit', async () => {
    const t = setup();
    const { user, form, input } = await openEditorAndType('A title');
    t.clientBSaves('B title');

    await user.click(within(form).getByRole('button', { name: 'Save' }));

    const alert = await within(form).findByRole('alert');
    expect(alert).toHaveTextContent(/changed by someone else/i);
    expect(alert).toHaveTextContent(/not saved/i);
    // Authoritative state is refetched and displayed…
    expect(await within(form).findByTestId('latest-title')).toHaveTextContent('B title');
    expect(within(alert).getByText(/v5/)).toBeInTheDocument();
    // …the user's text is preserved, nothing was retried, and the server kept B's change.
    expect(input).toHaveValue('A title');
    expect(t.patches()).toHaveLength(1);
    expect(t.patches()[0]!.body).toMatchObject({ expectedVersion: 4 });
    expect(t.serverState()).toMatchObject({ title: 'B title', version: 5 });
    // Saving is blocked until the user decides.
    expect(within(form).getByRole('button', { name: 'Save' })).toBeDisabled();
    // The board behind the dialog was refetched too.
    await waitFor(() =>
      expect(t.backend.callsTo('GET', /\/board$/).length).toBeGreaterThanOrEqual(2),
    );
  });

  it('lets the user knowingly re-apply their edit on top of the latest version', async () => {
    const t = setup();
    const { user, form } = await openEditorAndType('A title');
    t.clientBSaves('B title');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await within(form).findByTestId('latest-title');

    await user.click(within(form).getByRole('button', { name: 'Keep my edits and review' }));
    await user.click(within(form).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(t.serverState()).toMatchObject({ title: 'A title', version: 6 }));
    expect(t.patches().map((p) => (p.body as { expectedVersion: number }).expectedVersion)).toEqual(
      [4, 5],
    );
    expect(within(form).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('can discard the draft in favour of the latest version', async () => {
    const t = setup();
    const { user, form, input } = await openEditorAndType('A title');
    t.clientBSaves('B title');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await within(form).findByTestId('latest-title');

    await user.click(within(form).getByRole('button', { name: 'Discard my edits' }));
    expect(input).toHaveValue('B title');
    expect(within(form).getByRole('button', { name: 'Save' })).toBeDisabled(); // nothing to save
    expect(t.patches()).toHaveLength(1);
  });

  it('saves normally when nobody else changed the task', async () => {
    const t = setup();
    const { user, form } = await openEditorAndType('A title');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(t.serverState()).toMatchObject({ title: 'A title', version: 5 }));
    expect(within(form).queryByRole('alert')).not.toBeInTheDocument();
    expect(await within(form).findByText('Version 5')).toBeInTheDocument();
  });
});
