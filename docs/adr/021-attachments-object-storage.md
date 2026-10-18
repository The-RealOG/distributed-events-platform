# ADR-021: Attachments in S3 via presigned URLs; the API is the control plane only

**Status:** Accepted

## Context

Tasks need file attachments. Streaming bytes through the gateway and Project Service would tie
up their CPU, memory and connections for the duration of every transfer, force body limits up,
and put binary traffic on the same path as latency-sensitive JSON.

## Decision

**Metadata in PostgreSQL, bytes in S3, and the browser talks to S3 directly** using short-lived
presigned requests that the Project Service issues after authorizing:

```
1. POST /api/tasks/:id/attachments {filename, contentType, sizeBytes}
      → authorize (editTasks) → validate type/size → row (pending) → presigned POST (≤5 min)
2. browser ── multipart POST ──▶ S3            (bytes never touch the API)
3. POST /api/attachments/:id/complete → HEAD object → size ≤ declared → ready
4. GET  /api/attachments/:id/download → authorize (readProject) → presigned GET (60 s,
      Content-Disposition: attachment)
```

- **`ObjectStorage` interface** (`packages/storage`): `createUpload`, `createDownloadUrl`,
  `head`, `delete`; `S3ObjectStorage` implements it for AWS S3 and LocalStack. Service code
  never imports the AWS SDK.
- **Presigned POST, not PUT:** the policy binds the exact key, `eq $Content-Type`, and
  `content-length-range 1..declared size`, so S3 itself refuses a bigger body or a different
  type. Asserted on the signed policy (unit) and on real S3 (AWS demo: 400 / 403).
- **Controlled keys:** `workspaces/{ws}/projects/{p}/tasks/{t}/{attachmentId}`: tenant path
  plus a server-generated ID. The user's filename is display metadata only (sanitized; never
  part of a key or a raw header).
- **Limits:** content-type allowlist (`ATTACHMENT_CONTENT_TYPES`: PNG/JPEG/GIF/WebP, PDF,
  plain text/CSV/Markdown/JSON, zip, Office documents, MP4/WebM; never HTML or SVG) and
  `ATTACHMENT_MAX_BYTES` (default 100 MiB), enforced before signing and by the signed policy.
- **Authorization** happens before anything is signed, per request, via the task's project
  role, exactly like task CRUD.
- **Finalization via HEAD:** "ready" is decided from the stored object, not the browser's word.
- **Isolation of failures:** only attachment endpoints touch S3; S3 calls have a 3 s timeout
  and 2 attempts, and any storage failure is 503 `DEPENDENCY_UNAVAILABLE`. Task CRUD, board,
  activity, cache and realtime do not depend on S3.
- **AWS:** private bucket (public access blocked, SSE, BucketOwnerEnforced, TLS-only policy);
  CORS allows POST/GET from the app origin only; the project-service task role may
  Put/Get/Delete only under `workspaces/*` (+ ListBucket so a missing object reads as 404). The
  CSP's `connect-src` adds the bucket's regional endpoint.
- Presigned URLs are credentials: never logged (asserted in tests).
- Guarded by `tests/architecture/boundaries.test.ts`: the Project Service has no multipart or
  binary body parser and a 1 MiB body limit; `ObjectStorage` can only sign, HEAD and delete.

## Consequences

- API load is independent of file sizes; S3 transfer speed is the client's bandwidth to S3.
- The metadata row and the object cannot be written atomically; ADR-022 defines how they
  converge.
