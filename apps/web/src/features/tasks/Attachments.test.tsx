import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { makeBoard, USER, uuid } from '../../test/fakeBackend';
import { renderApp } from '../../test/renderApp';
import { formatBytes } from './Attachments';

// The browser → storage step is XHR to a presigned URL; here it is replaced at its boundary.
const upload = vi.hoisted(() => ({
  fail: false,
  calls: [] as { url: string; fields: Record<string, string> }[],
}));
vi.mock('../../lib/api/upload', () => ({
  uploadToStorage: async (
    target: { url: string; fields: Record<string, string> },
    _f: File,
    onProgress: (p: number) => void,
  ) => {
    upload.calls.push(target);
    onProgress(0.5);
    if (upload.fail) throw new Error('Network error during upload');
    onProgress(1);
  },
}));

function setup() {
  const board = makeBoard([['With files']]);
  const task = board.columns[0]!.tasks[0]!;
  const stored: { id: string; filename: string; sizeBytes: number }[] = [];
  const view = renderApp(`/projects/${board.project.id}/tasks/${task.id}`, {
    routes: (b) => {
      b.on('GET', /^\/projects\/[^/]+\/board$/, () => ({ status: 200, body: board }));
      b.on('GET', /^\/tasks\/[^/]+$/, () => ({ status: 200, body: task }));
      b.on('GET', /^\/tasks\/[^/]+\/comments$/, () => ({ status: 200, body: [] }));
      b.on('GET', /^\/workspaces\/[^/]+\/members$/, () => ({ status: 200, body: [] }));
      b.on('GET', /^\/tasks\/[^/]+\/attachments$/, () => ({
        status: 200,
        body: stored.map((s) => ({
          ...s,
          taskId: task.id,
          contentType: 'text/plain',
          status: 'ready',
          uploadedBy: USER.id,
          createdAt: new Date().toISOString(),
        })),
      }));
      b.on('POST', /^\/tasks\/[^/]+\/attachments$/, (call) => {
        const body = call.body as { filename: string; sizeBytes: number };
        const id = uuid();
        return {
          status: 201,
          body: {
            attachment: {
              id,
              taskId: task.id,
              filename: body.filename,
              contentType: 'text/plain',
              sizeBytes: body.sizeBytes,
              status: 'pending',
              uploadedBy: USER.id,
              createdAt: new Date().toISOString(),
            },
            upload: { url: 'https://storage.test/bucket', fields: { key: `k/${id}` } },
            expiresAt: new Date().toISOString(),
            maxBytes: body.sizeBytes,
          },
        };
      });
      b.on('POST', /^\/attachments\/[^/]+\/complete$/, (call) => {
        const id = call.path.split('/')[2]!;
        const posted = view.backend.callsTo('POST', /\/attachments$/).at(-1)!.body as {
          filename: string;
          sizeBytes: number;
        };
        stored.push({ id, filename: posted.filename, sizeBytes: posted.sizeBytes });
        return {
          status: 200,
          body: {
            id,
            taskId: task.id,
            filename: posted.filename,
            contentType: 'text/plain',
            sizeBytes: posted.sizeBytes,
            status: 'ready',
            uploadedBy: USER.id,
            createdAt: new Date().toISOString(),
          },
        };
      });
    },
  });
  return view;
}

describe('attachments', () => {
  it('uploads straight to storage, then lists the verified file', async () => {
    upload.fail = false;
    const view = setup();
    const section = await screen.findByRole('region', { name: 'Attachments' });
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    await userEvent.upload(within(section).getByLabelText('Choose files to attach'), file);
    expect(await within(section).findByText('notes.txt')).toBeInTheDocument();
    expect(within(section).getByText('5 B')).toBeInTheDocument();
    expect(view.backend.callsTo('POST', /\/attachments$/)[0]!.body).toEqual({
      filename: 'notes.txt',
      contentType: 'text/plain',
      sizeBytes: 5,
    });
    expect(view.backend.callsTo('POST', /\/complete$/)).toHaveLength(1);
    expect(upload.calls.at(-1)!.url).toBe('https://storage.test/bucket'); // not the API
  });

  it('refuses unsupported types before asking the server', async () => {
    const view = setup();
    const section = await screen.findByRole('region', { name: 'Attachments' });
    const input = within(section).getByLabelText('Choose files to attach');
    input.removeAttribute('accept');
    await userEvent.upload(input, new File(['<b>'], 'page.html', { type: 'text/html' }));
    expect(await within(section).findByRole('alert')).toHaveTextContent('not supported');
    expect(view.backend.callsTo('POST', /\/attachments$/)).toHaveLength(0);
  });

  it('shows a failed upload with Retry, which succeeds', async () => {
    upload.fail = true;
    setup();
    const section = await screen.findByRole('region', { name: 'Attachments' });
    await userEvent.upload(
      within(section).getByLabelText('Choose files to attach'),
      new File(['x'], 'a.txt', { type: 'text/plain' }),
    );
    expect(await within(section).findByRole('alert')).toHaveTextContent('Network error');
    upload.fail = false;
    await userEvent.click(within(section).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(within(section).queryByRole('alert')).not.toBeInTheDocument());
    expect(await within(section).findByText('a.txt')).toBeInTheDocument();
  });

  it('formats sizes', () => {
    expect([formatBytes(5), formatBytes(2048), formatBytes(5 * 1024 * 1024)]).toEqual([
      '5 B',
      '2.0 KB',
      '5.0 MB',
    ]);
  });
});
