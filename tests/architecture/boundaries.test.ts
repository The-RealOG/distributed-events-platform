import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Realtime and attachment boundaries that must not erode:
 * - Realtime notifications come only from committed Kafka events (ADR-016): the Project Service
 *   has no WebSocket capability at all.
 * - Attachment bytes go browser ⇄ S3 directly (ADR-021): the Project Service cannot receive a
 *   binary body and the storage abstraction cannot upload server-side.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (['node_modules', 'dist'].includes(name)) return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|js|mjs)$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}
const read = (file: string) => readFileSync(file, 'utf8');
const rel = (file: string) => file.slice(root.length + 1);
const deps = (app: string) => {
  const pkg = JSON.parse(read(join(root, app, 'package.json'))) as Record<
    string,
    Record<string, string> | undefined
  >;
  return Object.keys({ ...pkg['dependencies'], ...pkg['devDependencies'] });
};

describe('the Project Service never talks to browsers over WebSockets', () => {
  const SOCKET_MODULES = ['ws', '@fastify/websocket', '@dpp/realtime-service', 'socket.io'];

  it('declares no WebSocket dependency', () => {
    for (const m of SOCKET_MODULES) expect(deps('apps/project-service')).not.toContain(m);
  });

  it('imports no WebSocket module and never opens or broadcasts to a socket', () => {
    const offenders = sourceFiles(join(root, 'apps/project-service/src')).filter((file) => {
      const text = read(file);
      return (
        SOCKET_MODULES.some((m) => new RegExp(`from ['"]${m}['"/]`).test(text)) ||
        /\bnew WebSocket\b|websocket:\s*true|\.broadcast\(/.test(text)
      );
    });
    expect(offenders.map(rel)).toEqual([]);
  });
});

describe('attachment bytes never flow through our services', () => {
  it('the Project Service accepts no multipart or binary request bodies, and keeps a small body limit', () => {
    expect(deps('apps/project-service')).not.toContain('@fastify/multipart');
    const offenders = sourceFiles(join(root, 'apps/project-service/src')).filter((file) =>
      /@fastify\/multipart|addContentTypeParser|application\/octet-stream/.test(read(file)),
    );
    expect(offenders.map(rel)).toEqual([]);
    const limit = /bodyLimit:\s*([\d\s*_]+),/.exec(
      read(join(root, 'apps/project-service/src/app.ts')),
    );
    expect(limit).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- digits, spaces and * only
    expect(Number(new Function(`return ${limit![1]!.replace(/_/g, '')}`)())).toBeLessThanOrEqual(
      1024 * 1024,
    );
  });

  it('the storage abstraction can only sign, inspect and delete, not upload server-side', () => {
    const text = read(join(root, 'packages/storage/src/object-storage.ts'));
    expect(text).not.toMatch(/PutObjectCommand|UploadPartCommand|@aws-sdk\/lib-storage/);
    const iface = /export interface ObjectStorage \{([\s\S]*?)\n\}/.exec(text)?.[1] ?? '';
    const methods = [...iface.matchAll(/^\s{2}(\w+)\(/gm)].map((m) => m[1]).sort();
    expect(methods).toEqual(['createDownloadUrl', 'createUpload', 'delete', 'head']);
  });

  it('services use object storage only through @dpp/storage (no direct AWS SDK)', () => {
    const offenders = ['apps/project-service', 'apps/api-gateway'].flatMap((app) =>
      sourceFiles(join(root, app, 'src')).filter((file) => /from ['"]@aws-sdk\//.test(read(file))),
    );
    expect(offenders.map(rel)).toEqual([]);
  });
});
