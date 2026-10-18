import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { column, seedProject, signInAs } from './support.js';

/**
 * Kafka independence: Kafka is available infrastructure, but serving project-management traffic
 * does not depend on it. With the broker stopped, the full browser → gateway →
 * project-service → PostgreSQL path must keep working. Mutations succeed with Kafka down; their
 * events wait in the outbox.
 */
const repoRoot = resolve(import.meta.dirname, '../..');
const compose = (args: string) =>
  execSync(`docker compose ${args}`, { cwd: repoRoot, stdio: 'pipe', timeout: 180_000 });

test.describe.configure({ mode: 'serial', timeout: 240_000 });

test.afterAll(() => {
  compose('start kafka');
});

test('project CRUD works end to end while Kafka is stopped', async ({ browser, request }) => {
  compose('stop kafka');
  expect(compose('ps kafka --format "{{.State}}"').toString()).not.toContain('running');

  const seed = await seedProject(request);
  const context = await browser.newContext();
  await signInAs(context, seed.owner);
  const page = await context.newPage();
  await page.goto(`/projects/${seed.projectId}`);

  await column(page, 'To Do').getByRole('button', { name: 'Add a task', exact: true }).click();
  await page.getByLabel('New task in To Do').fill('Works without Kafka');
  await column(page, 'To Do').getByRole('button', { name: 'Add task', exact: true }).click();
  const card = column(page, 'To Do').getByRole('button', {
    name: 'Works without Kafka',
    exact: true,
  });
  await expect(card).toBeVisible();

  await card.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Title').fill('Still works without Kafka');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText('Version 2')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close task' }).click();

  await page.getByLabel('Move Still works without Kafka to column').selectOption({ label: 'Done' });
  await expect(
    column(page, 'Done').getByRole('button', { name: 'Still works without Kafka', exact: true }),
  ).toBeVisible();

  const board = await seed.client.get(`/projects/${seed.projectId}/board`);
  expect(board.body.columns[2].tasks[0]).toMatchObject({
    title: 'Still works without Kafka',
    version: 3,
  });
  await context.close();
});
