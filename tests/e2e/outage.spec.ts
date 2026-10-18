import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { API_URL, column, seedProject, signInAs, type TestUser } from './support.js';

// Stops and restarts real containers, so it runs serially and always restores them. The
// budget must cover the recovery wait below (container restart + readiness) on a loaded host.
test.describe.configure({ mode: 'serial', timeout: 240_000 });

const repoRoot = resolve(import.meta.dirname, '../..');
const compose = (args: string) =>
  execSync(`docker compose ${args}`, { cwd: repoRoot, stdio: 'pipe', timeout: 180_000 });

async function waitForApi(request: APIRequestContext, user: TestUser) {
  await expect
    .poll(
      async () =>
        (
          await request.get(`${API_URL}/workspaces`, {
            headers: { authorization: `Bearer ${user.token}` },
          })
        ).status(),
      { timeout: 120_000, intervals: [1_000] },
    )
    .toBe(200);
}

// Several parts of the page may report the outage at once (board, current user); any one
// of them saying "temporarily unavailable" is what the user needs to see.
const unavailable = (page: Page) =>
  page
    .getByRole('alert')
    .filter({ hasText: /temporarily unavailable/i })
    .first();

test.afterAll(() => {
  compose('start postgres project-service');
});

for (const dependency of ['postgres', 'project-service'] as const) {
  test(`${dependency} outage: board shows temporary unavailability, keeps context, and recovers`, async ({
    browser,
    request,
  }) => {
    const seed = await seedProject(request);
    const created = await seed.client.post('/tasks', {
      projectId: seed.projectId,
      columnId: seed.columns[0]!.id,
      title: 'Survives the outage',
    });
    expect(created.status).toBe(201);
    // The seed read the board before this create, so other clients see the task only once its
    // event has invalidated the shared board cache (ADR-015). An earlier spec restarts Kafka,
    // and consumers rejoin their groups only after the old members' session timeout.
    await expect
      .poll(
        async () =>
          (await seed.client.get(`/projects/${seed.projectId}/board`)).body?.columns?.[0]?.tasks
            ?.length,
        { timeout: 90_000, intervals: [1_000] },
      )
      .toBe(1);
    const context = await browser.newContext();
    await signInAs(context, seed.owner);
    const page = await context.newPage();
    await page.goto(`/projects/${seed.projectId}`);
    await expect(
      column(page, 'To Do').getByRole('button', { name: 'Survives the outage', exact: true }),
    ).toBeVisible();

    compose(`stop ${dependency}`);
    try {
      // A failed refresh keeps the board the user was looking at.
      await page.getByRole('button', { name: 'Refresh' }).click();
      await expect(page.getByText(/as last loaded/i)).toBeVisible();
      await expect(unavailable(page)).toBeVisible();
      await expect(
        column(page, 'To Do').getByRole('button', { name: 'Survives the outage', exact: true }),
      ).toBeVisible();

      // A fresh load has nothing to show, so it offers a retry.
      await page.reload();
      await expect(unavailable(page)).toBeVisible({ timeout: 45_000 });
      await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    } finally {
      compose(`start ${dependency}`);
    }

    await waitForApi(request, seed.owner);
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(
      column(page, 'To Do').getByRole('button', { name: 'Survives the outage', exact: true }),
    ).toBeVisible();
    await context.close();
  });
}
