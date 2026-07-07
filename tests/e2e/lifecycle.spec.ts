import { expect, test } from '@playwright/test';
import { api, apiLogin, column, uniqueEmail, API_URL } from './support.js';

test('full task lifecycle through browser → gateway → project-service → PostgreSQL', async ({
  page,
  request,
}) => {
  // A second person must have signed in once before they can be added to a workspace.
  const bob = await apiLogin(request, 'Bob');
  const email = uniqueEmail('Ada');

  // 1. Log in (unauthenticated users are sent to /login and returned afterwards).
  await page.goto('/workspaces');
  await expect(page).toHaveURL(/\/login\?returnTo=/);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Display name').fill('Ada');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible();
  await expect(page.getByText(/aren’t in any workspaces/)).toBeVisible();

  // 2. Create a workspace and add a member.
  await page.getByLabel('New workspace name').fill('Acme');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('heading', { name: /Acme/ })).toBeVisible();
  await page.getByLabel('Member email').fill(bob.email);
  await page.getByRole('button', { name: 'Add member' }).click();
  await expect(page.getByText(bob.email)).toBeVisible();

  // 3. Create a project; the board loads with its default columns.
  await expect(page.getByText('No projects yet.')).toBeVisible();
  await page.getByLabel('New project name').fill('Launch');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name: 'Launch' })).toBeVisible();
  for (const name of ['To Do', 'In Progress', 'Done']) {
    await expect(column(page, name).getByText(/^No (completed )?tasks yet$/)).toBeVisible();
  }
  const projectId = /\/projects\/([^/]+)/.exec(page.url())![1]!;

  // 4. Create a task.
  await column(page, 'To Do').getByRole('button', { name: 'Add a task', exact: true }).click();
  await page.getByLabel('New task in To Do').fill('Write spec');
  await column(page, 'To Do').getByRole('button', { name: 'Add task', exact: true }).click();
  await expect(
    column(page, 'To Do').getByRole('button', { name: 'Write spec', exact: true }),
  ).toBeVisible();

  // 5. Edit it.
  await column(page, 'To Do').getByRole('button', { name: 'Write spec', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Title')).toHaveValue('Write spec');
  await dialog.getByLabel('Title').fill('Write the spec');
  await dialog.getByLabel('Description').fill('Cover the API and failure modes.');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText('Version 2')).toBeVisible();

  // 6. Assign Bob.
  await dialog.getByLabel('Assign member').selectOption({ label: 'Bob' });
  await dialog.getByRole('button', { name: 'Assign' }).click();
  await expect(dialog.getByRole('button', { name: 'Unassign Bob' })).toBeVisible();

  // 7. Comment.
  await expect(dialog.getByText('No comments yet.')).toBeVisible();
  await dialog.getByLabel('Comment', { exact: true }).fill('Looks good');
  await dialog.getByRole('button', { name: 'Post comment' }).click();
  await expect(dialog.getByText('Looks good')).toBeVisible();

  // 8. Move it to another column.
  await dialog.getByRole('button', { name: 'Close task' }).click();
  await expect(dialog).toBeHidden();
  await page.getByLabel('Move Write the spec to column').selectOption({ label: 'In Progress' });
  await expect(
    column(page, 'In Progress').getByRole('button', { name: 'Write the spec', exact: true }),
  ).toBeVisible();
  await expect(column(page, 'To Do').getByText('No tasks yet')).toBeVisible();

  // The server agrees (authoritative check through the gateway, not the UI).
  const token = await page.evaluate(() => localStorage.getItem('dpp.session.token'));
  const client = api(request, { token: token!, email, name: 'Ada', id: '' });
  const board = await client.get(`/projects/${projectId}/board`);
  const moved = board.body.columns[1].tasks[0];
  expect(moved).toMatchObject({ title: 'Write the spec', assigneeIds: [bob.id] });
  expect(moved.version).toBeGreaterThanOrEqual(4); // edit, assign, move

  // 9. Delete it.
  await column(page, 'In Progress')
    .getByRole('button', { name: 'Write the spec', exact: true })
    .click();
  await dialog.getByRole('button', { name: 'Delete task' }).click();
  await dialog.getByRole('button', { name: 'Confirm delete' }).click();
  await expect(page.getByText('Task deleted.')).toBeVisible();
  await expect(column(page, 'In Progress').getByText('No tasks yet')).toBeVisible();
  expect((await client.get(`/tasks/${moved.id}`)).status).toBe(404);

  // Traffic went through the gateway only.
  expect(API_URL).toContain(':3000');
});
