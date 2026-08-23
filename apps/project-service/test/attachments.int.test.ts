import { randomUUID } from 'node:crypto';
import { CreateBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createDatabase, type DatabaseHandle } from '@dpp/database';
import { S3ObjectStorage } from '@dpp/storage';
import { startS3, type StartedS3 } from '@dpp/test-utils';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { AttachmentService } from '../src/modules/attachments/service.js';
import {
  addMember,
  createHarness,
  createProjectFixture,
  createTask,
  type Harness,
} from './harness.js';

/**
 * Attachments against real PostgreSQL and S3-compatible storage (ADR-021). The test plays the
 * browser: it uploads to the presigned target directly, never through the API.
 */
let s3: StartedS3;
let h: Harness;
let down: Harness;
let service: AttachmentService;
let serviceDb: DatabaseHandle;
const bucket = 'attachments-it';
const logLines: string[] = [];
const MAX = 64 * 1024;

beforeAll(async () => {
  s3 = await startS3();
  const credentials = { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey };
  await new S3Client({
    region: s3.region,
    endpoint: s3.endpoint,
    forcePathStyle: true,
    credentials,
  }).send(new CreateBucketCommand({ Bucket: bucket }));
  const limits = {
    maxBytes: MAX,
    uploadUrlTtlSeconds: 60,
    downloadUrlTtlSeconds: 30,
    pendingTtlSeconds: 60,
  };
  const logger = pino({ level: 'debug' }, { write: (l: string) => void logLines.push(l) });
  const storage = new S3ObjectStorage({
    bucket,
    region: s3.region,
    endpoint: s3.endpoint,
    forcePathStyle: true,
    credentials,
  });
  // The service gets its own pool on the same test database as the harness.
  serviceDb = createDatabase({
    connectionString: inject('databaseUrl'),
    applicationName: 'attachments-it',
  });
  service = new AttachmentService(serviceDb.db, storage, limits, logger);
  h = await createHarness(undefined, { attachments: service });
  // Same app, storage unreachable.
  const unreachable = new S3ObjectStorage({
    bucket,
    region: s3.region,
    endpoint: 'http://127.0.0.1:9',
    forcePathStyle: true,
    credentials,
    requestTimeoutMs: 500,
  });
  down = await createHarness(undefined, {
    attachments: new AttachmentService(serviceDb.db, unreachable, limits, logger),
  });
});
afterAll(async () => {
  await h?.close();
  await down?.close();
  await serviceDb?.close();
  await s3?.stop();
});

async function browserUpload(target: { url: string; fields: Record<string, string> }, body: Blob) {
  const form = new FormData();
  for (const [k, v] of Object.entries(target.fields)) form.append(k, v);
  form.append('file', body);
  return fetch(target.url, { method: 'POST', body: form });
}

async function setupTask() {
  const f = await createProjectFixture(h);
  const task = await createTask(h, f, 'With files');
  return { f, task };
}

describe('attachments', () => {
  it('upload → finalize → list → download → delete, with bytes going straight to storage', async () => {
    const { f, task } = await setupTask();
    const req = await h.call('POST', `/tasks/${task.id}/attachments`, {
      as: f.owner,
      body: { filename: '../../etc/passwd notes.txt', contentType: 'text/plain', sizeBytes: 11 },
    });
    expect(req.status).toBe(201);
    const { attachment, upload } = req.body;
    expect(attachment).toMatchObject({
      status: 'pending',
      filename: 'passwd notes.txt',
      sizeBytes: 11,
    });
    // Controlled key: tenant path + generated id; no part of the user's file name.
    expect(upload.fields.key).toBe(
      `workspaces/${f.workspaceId}/projects/${f.projectId}/tasks/${task.id}/${attachment.id}`,
    );
    expect(upload.url).not.toContain('/api/');

    // Not listed (nor downloadable) until verified.
    expect((await h.call('GET', `/tasks/${task.id}/attachments`, { as: f.owner })).body).toEqual(
      [],
    );
    expect((await browserUpload(upload, new Blob(['hello world']))).status).toBeLessThan(300);
    const done = await h.call('POST', `/attachments/${attachment.id}/complete`, { as: f.owner });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: 'ready', sizeBytes: 11 });

    const list = await h.call('GET', `/tasks/${task.id}/attachments`, { as: f.owner });
    expect(list.body.map((a: { id: string }) => a.id)).toEqual([attachment.id]);
    const dl = await h.call('GET', `/attachments/${attachment.id}/download`, { as: f.owner });
    expect(dl.status).toBe(200);
    const file = await fetch(dl.body.url);
    expect(await file.text()).toBe('hello world');
    expect(file.headers.get('content-disposition')).toContain('attachment');

    expect((await h.call('DELETE', `/attachments/${attachment.id}`, { as: f.owner })).status).toBe(
      204,
    );
    expect((await h.call('DELETE', `/attachments/${attachment.id}`, { as: f.owner })).status).toBe(
      204,
    );
    expect((await h.call('GET', `/tasks/${task.id}/attachments`, { as: f.owner })).body).toEqual(
      [],
    );
    expect(
      (await h.call('GET', `/attachments/${attachment.id}/download`, { as: f.owner })).status,
    ).toBe(404);
    expect((await fetch(dl.body.url)).status).toBe(404); // the object is gone too

    // Presigned URLs are credentials: never in logs.
    const logs = logLines.join('\n');
    expect(logs).not.toContain('X-Amz-Signature');
    expect(logs).not.toContain(upload.fields.Policy);
  });

  it('refuses to mark ready an upload that never happened', async () => {
    const { f, task } = await setupTask();
    const req = await h.call('POST', `/tasks/${task.id}/attachments`, {
      as: f.owner,
      body: { filename: 'x.pdf', contentType: 'application/pdf', sizeBytes: 100 },
    });
    const done = await h.call('POST', `/attachments/${req.body.attachment.id}/complete`, {
      as: f.owner,
    });
    expect(done.status).toBe(409);
    expect(done.body.error.code).toBe('UPLOAD_INCOMPLETE');
  });

  it('enforces size and type: over-limit and disallowed types are refused before signing; S3 refuses a bigger body', async () => {
    const { f, task } = await setupTask();
    const big = await h.call('POST', `/tasks/${task.id}/attachments`, {
      as: f.owner,
      body: { filename: 'big.bin', contentType: 'application/zip', sizeBytes: MAX + 1 },
    });
    expect(big.status).toBe(413);
    const html = await h.call('POST', `/tasks/${task.id}/attachments`, {
      as: f.owner,
      body: { filename: 'page.html', contentType: 'text/html', sizeBytes: 10 },
    });
    expect(html.status).toBe(415);

    const small = await h.call('POST', `/tasks/${task.id}/attachments`, {
      as: f.owner,
      body: { filename: 'a.txt', contentType: 'text/plain', sizeBytes: 5 },
    });
    expect(
      (await browserUpload(small.body.upload, new Blob(['more than five bytes']))).status,
    ).toBe(400);
    expect(
      (await h.call('POST', `/attachments/${small.body.attachment.id}/complete`, { as: f.owner }))
        .status,
    ).toBe(409);
  });

  it('a stored object larger than declared (not via our signed POST) is refused and removed', async () => {
    const { f, task } = await setupTask();
    const req = await h.call('POST', `/tasks/${task.id}/attachments`, {
      as: f.owner,
      body: { filename: 'a.txt', contentType: 'text/plain', sizeBytes: 3 },
    });
    await new S3Client({
      region: s3.region,
      endpoint: s3.endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
    }).send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: req.body.upload.fields.key,
        Body: 'way more than three',
      }),
    );
    const done = await h.call('POST', `/attachments/${req.body.attachment.id}/complete`, {
      as: f.owner,
    });
    expect(done.status).toBe(413);
  });

  it('authorization happens before any signing: outsiders cannot upload, list, download or delete', async () => {
    const { f, task } = await setupTask();
    const req = await h.call('POST', `/tasks/${task.id}/attachments`, {
      as: f.owner,
      body: { filename: 'a.txt', contentType: 'text/plain', sizeBytes: 2 },
    });
    await browserUpload(req.body.upload, new Blob(['ok']));
    await h.call('POST', `/attachments/${req.body.attachment.id}/complete`, { as: f.owner });

    const outsider = await h.login('outsider');
    const other = await createProjectFixture(h); // a project the outsider owns
    const id = req.body.attachment.id as string;
    expect(
      (
        await h.call('POST', `/tasks/${task.id}/attachments`, {
          as: outsider,
          body: { filename: 'x.txt', contentType: 'text/plain', sizeBytes: 1 },
        })
      ).status,
    ).toBe(403);
    expect((await h.call('GET', `/tasks/${task.id}/attachments`, { as: outsider })).status).toBe(
      403,
    );
    expect((await h.call('GET', `/attachments/${id}/download`, { as: outsider })).status).toBe(403);
    expect((await h.call('DELETE', `/attachments/${id}`, { as: outsider })).status).toBe(403);
    expect((await h.call('GET', `/attachments/${id}/download`, { as: other.owner })).status).toBe(
      403,
    );
    expect(
      (await h.call('GET', `/attachments/${randomUUID()}/download`, { as: f.owner })).status,
    ).toBe(404);
    // A member can read.
    const member = await addMember(h, f);
    expect((await h.call('GET', `/attachments/${id}/download`, { as: member })).status).toBe(200);
  });

  it('the sweep removes abandoned uploads and finishes deletions whose object delete failed', async () => {
    const { f, task } = await setupTask();
    const req = await h.call('POST', `/tasks/${task.id}/attachments`, {
      as: f.owner,
      body: { filename: 'late.txt', contentType: 'text/plain', sizeBytes: 4 },
    });
    await browserUpload(req.body.upload, new Blob(['late']));
    // Abandoned: never finalized, and older than the pending TTL.
    await h.database.pool.query(
      `UPDATE attachments SET created_at = now() - interval '2 hours' WHERE id = $1`,
      [req.body.attachment.id],
    );
    // A deletion whose object delete "failed" earlier.
    const req2 = await h.call('POST', `/tasks/${task.id}/attachments`, {
      as: f.owner,
      body: { filename: 'b.txt', contentType: 'text/plain', sizeBytes: 1 },
    });
    await browserUpload(req2.body.upload, new Blob(['b']));
    await h.call('POST', `/attachments/${req2.body.attachment.id}/complete`, { as: f.owner });
    await h.database.pool.query(
      `UPDATE attachments SET status = 'deleted', deleted_at = now() WHERE id = $1`,
      [req2.body.attachment.id],
    );

    expect(await service.sweep()).toBeGreaterThanOrEqual(2);
    const rows = await h.database.pool.query<{ status: string; object_deleted_at: Date | null }>(
      'SELECT status, object_deleted_at FROM attachments WHERE id = ANY($1::uuid[])',
      [[req.body.attachment.id, req2.body.attachment.id]],
    );
    expect(rows.rows.every((r) => r.status === 'deleted' && r.object_deleted_at !== null)).toBe(
      true,
    );
  });

  it('storage outage: attachment requests fail fast with 503; task CRUD is unaffected', async () => {
    const f = await createProjectFixture(down);
    const task = await createTask(down, f, 'Still works');
    const started = performance.now();
    const res = await down.call('POST', `/tasks/${task.id}/attachments`, {
      as: f.owner,
      body: { filename: 'x.txt', contentType: 'text/plain', sizeBytes: 1 },
    });
    // Presigning needs no network, so the upload URL is issued; finalization needs storage.
    if (res.status === 201) {
      const done = await down.call('POST', `/attachments/${res.body.attachment.id}/complete`, {
        as: f.owner,
      });
      expect(done.status).toBe(503);
      expect(done.body.error.code).toBe('DEPENDENCY_UNAVAILABLE');
    } else {
      expect(res.status).toBe(503);
    }
    expect(performance.now() - started).toBeLessThan(10_000);
    const patch = await down.call('PATCH', `/tasks/${task.id}`, {
      as: f.owner,
      body: { expectedVersion: 1, title: 'Renamed while S3 is down' },
    });
    expect(patch.status).toBe(200);
    expect((await down.call('GET', `/projects/${f.projectId}/board`, { as: f.owner })).status).toBe(
      200,
    );
  });
});
