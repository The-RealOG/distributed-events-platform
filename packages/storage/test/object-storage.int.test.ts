import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { startS3, type StartedS3 } from '@dpp/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { S3ObjectStorage } from '../src/index.js';

let s3: StartedS3;
let storage: S3ObjectStorage;
const bucket = 'attachments-test';

beforeAll(async () => {
  s3 = await startS3();
  const credentials = { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey };
  await new S3Client({
    region: 'us-east-1',
    endpoint: s3.endpoint,
    forcePathStyle: true,
    credentials,
  }).send(new CreateBucketCommand({ Bucket: bucket }));
  storage = new S3ObjectStorage({
    bucket,
    region: 'us-east-1',
    endpoint: s3.endpoint,
    forcePathStyle: true,
    credentials,
  });
});
afterAll(() => s3?.stop());

/** Uploads the way a browser does: multipart form POST straight to the storage URL. */
async function upload(
  target: { url: string; fields: Record<string, string> },
  body: Blob,
  contentType?: string,
) {
  const form = new FormData();
  for (const [k, v] of Object.entries(target.fields)) form.append(k, v);
  if (contentType) form.set('Content-Type', contentType);
  form.append('file', body);
  return fetch(target.url, { method: 'POST', body: form });
}

describe('presigned upload/download (S3-compatible storage)', () => {
  it('uploads directly with the presigned POST; head reports it; download URL serves it as an attachment', async () => {
    const key = `workspaces/w/projects/p/tasks/t/${crypto.randomUUID()}`;
    const target = await storage.createUpload({
      key,
      contentType: 'text/plain',
      maxBytes: 1024,
      expiresSeconds: 60,
    });
    const res = await upload(target, new Blob(['hello']));
    expect(res.status).toBeLessThan(300);
    expect(await storage.head(key)).toEqual({ sizeBytes: 5, contentType: 'text/plain' });

    const url = await storage.createDownloadUrl({ key, filename: 'note.txt', expiresSeconds: 60 });
    const download = await fetch(url);
    expect(await download.text()).toBe('hello');
    expect(download.headers.get('content-disposition')).toContain(
      'attachment; filename="note.txt"',
    );
  });

  it('S3 enforces the size limit, the content type and the key (the browser cannot change them)', async () => {
    const key = `k/${crypto.randomUUID()}`;
    const target = await storage.createUpload({
      key,
      contentType: 'image/png',
      maxBytes: 10,
      expiresSeconds: 60,
    });
    expect((await upload(target, new Blob(['x'.repeat(11)]))).status).toBe(400); // too big
    expect((await upload(target, new Blob(['tiny']), 'text/html')).status).toBe(403); // other type
    const otherKey = {
      url: target.url,
      fields: { ...target.fields, key: `k/${crypto.randomUUID()}` },
    };
    expect((await upload(otherKey, new Blob(['tiny']))).status).toBe(403); // other key
    expect(await storage.head(key)).toBeNull();
  });

  it('rejects an expired upload URL', async () => {
    const key = `k/${crypto.randomUUID()}`;
    const target = await storage.createUpload({
      key,
      contentType: 'text/plain',
      maxBytes: 10,
      expiresSeconds: 1,
    });
    await new Promise((r) => setTimeout(r, 2_500));
    expect((await upload(target, new Blob(['late']))).status).toBe(403);
  });

  it('head of a missing object is null; delete is idempotent', async () => {
    const key = `k/${crypto.randomUUID()}`;
    expect(await storage.head(key)).toBeNull();
    await storage.delete(key);
    await storage.delete(key);
  });

  it('fails fast with StorageUnavailableError when storage is unreachable', async () => {
    const down = new S3ObjectStorage({
      bucket,
      region: 'us-east-1',
      endpoint: 'http://127.0.0.1:9',
      forcePathStyle: true,
      credentials: { accessKeyId: 'x', secretAccessKey: 'y' },
      requestTimeoutMs: 500,
    });
    const started = performance.now();
    await expect(down.head('k')).rejects.toThrow('Object storage is unavailable');
    expect(performance.now() - started).toBeLessThan(5_000);
  });
});
