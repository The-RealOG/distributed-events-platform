import { describe, expect, it } from 'vitest';
import { contentDisposition, S3ObjectStorage } from './object-storage.js';

describe('contentDisposition', () => {
  it('always downloads as an attachment, with a safe ASCII fallback and the exact UTF-8 name', () => {
    expect(contentDisposition('report.pdf')).toBe(
      `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`,
    );
    const tricky = contentDisposition('résumé "final"\r\nX-Evil: 1.pdf');
    expect(tricky.startsWith('attachment; filename="r_sum_ _final___X-Evil: 1.pdf"')).toBe(true);
    expect(tricky).not.toMatch(/[\r\n]/);
    expect(tricky).toContain(encodeURIComponent('résumé'));
  });
});

describe('presigned upload policy', () => {
  // What S3 enforces is the signed policy document, so assert on it directly (S3 emulators do
  // not all evaluate every condition). Signing needs no network.
  it('binds the exact key, the declared content type, the size range and a short expiry', async () => {
    const storage = new S3ObjectStorage({
      bucket: 'b',
      region: 'us-east-2',
      credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'example-secret' },
    });
    const before = Date.now();
    const { fields } = await storage.createUpload({
      key: 'workspaces/w/projects/p/tasks/t/a',
      contentType: 'image/png',
      maxBytes: 1234,
      expiresSeconds: 300,
    });
    const policy = JSON.parse(Buffer.from(fields['Policy']!, 'base64').toString('utf8')) as {
      expiration: string;
      conditions: unknown[];
    };
    expect(policy.conditions).toEqual(
      expect.arrayContaining([
        { bucket: 'b' },
        { key: 'workspaces/w/projects/p/tasks/t/a' },
        ['content-length-range', 1, 1234],
        ['eq', '$Content-Type', 'image/png'],
      ]),
    );
    // No condition may widen what the browser controls.
    expect(JSON.stringify(policy.conditions)).not.toMatch(/starts-with/);
    const expires = Date.parse(policy.expiration) - before;
    expect(expires).toBeGreaterThan(290_000);
    expect(expires).toBeLessThanOrEqual(301_000);
  });
});
