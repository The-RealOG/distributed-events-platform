import { expect, test } from '@playwright/test';
import { seedProject, signInAs } from './support.js';

/**
 * Two real browsers, two users, one task.
 * A loads v1 → B saves (server v2) → A saves with v1 → 409 → A sees B's version, keeps their
 * text, nothing is overwritten; A then explicitly re-applies on top of v2.
 */
test('stale edit from a second client is rejected, shown, and never silently overwrites', async ({
  browser,
  request,
}) => {
  const seed = await seedProject(request, { withMember: true });
  const task = await seed.client.post('/tasks', {
    projectId: seed.projectId,
    columnId: seed.columns[0]!.id,
    title: 'Original title',
  });
  const taskUrl = `/projects/${seed.projectId}/tasks/${task.body.id}`;

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  await signInAs(contextA, seed.owner);
  await signInAs(contextB, seed.member!);
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  const patchesFromA: { expectedVersion: number }[] = [];
  pageA.on('request', (req) => {
    if (req.method() === 'PATCH' && req.url().includes('/api/tasks/')) {
      patchesFromA.push(req.postDataJSON() as { expectedVersion: number });
    }
  });

  // Both clients load version 1.
  await pageA.goto(taskUrl);
  await pageB.goto(taskUrl);
  const dialogA = pageA.getByRole('dialog');
  const dialogB = pageB.getByRole('dialog');
  await expect(dialogA.getByText('Version 1')).toBeVisible();
  await expect(dialogB.getByText('Version 1')).toBeVisible();

  // A starts editing; B saves first.
  await dialogA.getByLabel('Title').fill('Title from A');
  await dialogB.getByLabel('Title').fill('Title from B');
  await dialogB.getByRole('button', { name: 'Save' }).click();
  await expect(dialogB.getByText('Version 2')).toBeVisible();

  // A saves against version 1.
  await dialogA.getByRole('button', { name: 'Save' }).click();
  const conflict = dialogA.getByRole('alert');
  await expect(conflict).toContainText('changed by someone else');
  await expect(conflict).toContainText('not saved');
  await expect(dialogA.getByTestId('latest-title')).toHaveText('Title from B');
  await expect(dialogA.getByLabel('Title')).toHaveValue('Title from A');
  await expect(dialogA.getByRole('button', { name: 'Save' })).toBeDisabled();

  // The server kept B's change and saw exactly one attempt from A.
  let server = await seed.client.get(`/tasks/${task.body.id}`);
  expect(server.body).toMatchObject({ title: 'Title from B', version: 2 });
  expect(patchesFromA).toEqual([expect.objectContaining({ expectedVersion: 1 })]);

  // A decides to re-apply their edit knowingly.
  await dialogA.getByRole('button', { name: 'Keep my edits and review' }).click();
  await dialogA.getByRole('button', { name: 'Save' }).click();
  await expect(dialogA.getByText('Version 3')).toBeVisible();
  server = await seed.client.get(`/tasks/${task.body.id}`);
  expect(server.body).toMatchObject({ title: 'Title from A', version: 3 });
  expect(patchesFromA.map((p) => p.expectedVersion)).toEqual([1, 2]);

  await contextA.close();
  await contextB.close();
});
