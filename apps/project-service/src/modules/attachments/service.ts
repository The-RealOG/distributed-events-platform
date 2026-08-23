import { randomUUID } from 'node:crypto';
import type { Principal } from '@dpp/auth';
import type { AttachmentDownloadDto, AttachmentDto, AttachmentUploadDto } from '@dpp/contracts';
import { attachments, type Database } from '@dpp/database';
import { StorageUnavailableError, type ObjectStorage } from '@dpp/storage';
import { and, eq, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { requireTaskRole } from '../../domain/access.js';
import { REQUIRED_ROLE } from '../../domain/roles.js';
import { AppError, notFound } from '../../http/errors.js';
import { iso } from '../../http/schemas.js';
import { cleanFilename, isAllowedContentType, objectKey } from './policy.js';

export interface AttachmentLimits {
  maxBytes: number;
  uploadUrlTtlSeconds: number;
  downloadUrlTtlSeconds: number;
  /** A pending upload older than this is abandoned: the sweep deletes its object and row. */
  pendingTtlSeconds: number;
}

type AttachmentRow = typeof attachments.$inferSelect;

const toDto = (row: AttachmentRow): AttachmentDto => ({
  id: row.id,
  taskId: row.taskId,
  filename: row.originalFilename,
  contentType: row.contentType,
  sizeBytes: row.sizeBytes,
  status: row.status as 'pending' | 'ready',
  uploadedBy: row.uploadedBy,
  createdAt: iso(row.createdAt),
});

const storageDown = () =>
  new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'File storage is unavailable; try again shortly');

/**
 * Attachment control plane (ADR-021). Authorization always happens here, before anything is
 * signed; S3 enforces the signed limits. Only attachment requests touch object storage, so an
 * S3 outage cannot affect task CRUD.
 */
export class AttachmentService {
  constructor(
    private readonly db: Database,
    private readonly storage: ObjectStorage,
    private readonly limits: AttachmentLimits,
    private readonly log: Logger,
  ) {}

  async requestUpload(
    principal: Principal,
    taskId: string,
    input: { filename: string; contentType: string; sizeBytes: number },
  ): Promise<AttachmentUploadDto> {
    const { task, workspaceId } = await requireTaskRole(
      this.db,
      principal.userId,
      taskId,
      REQUIRED_ROLE.editTasks,
    );
    if (!isAllowedContentType(input.contentType)) {
      throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'This file type is not accepted', {
        contentType: input.contentType,
      });
    }
    if (input.sizeBytes > this.limits.maxBytes) {
      throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'File is too large', {
        maxBytes: this.limits.maxBytes,
      });
    }
    const id = randomUUID();
    const key = objectKey({ workspaceId, projectId: task.projectId, taskId, attachmentId: id });
    let upload;
    try {
      upload = await this.storage.createUpload({
        key,
        contentType: input.contentType,
        maxBytes: input.sizeBytes, // exactly what was declared, never more
        expiresSeconds: this.limits.uploadUrlTtlSeconds,
      });
    } catch (err) {
      this.log.warn({ err: err instanceof Error ? err.message : String(err) }, 'presign failed');
      throw storageDown();
    }
    const [row] = await this.db
      .insert(attachments)
      .values({
        id,
        workspaceId,
        projectId: task.projectId,
        taskId,
        uploadedBy: principal.userId,
        objectKey: key,
        originalFilename: cleanFilename(input.filename),
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
      })
      .returning();
    // The URL and form fields are a temporary credential: never logged.
    this.log.info(
      { attachmentId: id, taskId, sizeBytes: input.sizeBytes },
      'attachment upload authorized',
    );
    return {
      attachment: toDto(row!),
      upload,
      expiresAt: new Date(Date.now() + this.limits.uploadUrlTtlSeconds * 1000).toISOString(),
      maxBytes: input.sizeBytes,
    };
  }

  /** Marks the upload ready only after verifying the stored object (not the browser's word). */
  async complete(principal: Principal, attachmentId: string): Promise<AttachmentDto> {
    const row = await this.#load(principal, attachmentId, REQUIRED_ROLE.editTasks);
    if (row.status === 'ready') return toDto(row);
    if (row.status !== 'pending') throw notFound('Attachment');
    let head;
    try {
      head = await this.storage.head(row.objectKey);
    } catch (err) {
      if (err instanceof StorageUnavailableError) throw storageDown();
      throw err;
    }
    if (!head) {
      throw new AppError(
        409,
        'UPLOAD_INCOMPLETE',
        'The file has not been uploaded (or the upload failed)',
      );
    }
    if (head.sizeBytes <= 0 || head.sizeBytes > Math.min(row.sizeBytes, this.limits.maxBytes)) {
      // Cannot happen through the signed POST; refuse and remove anything that got there anyway.
      await this.storage.delete(row.objectKey).catch(() => undefined);
      throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Stored file exceeds the declared size');
    }
    const [ready] = await this.db
      .update(attachments)
      .set({ status: 'ready', sizeBytes: head.sizeBytes, readyAt: sql`now()` })
      .where(and(eq(attachments.id, row.id), eq(attachments.status, 'pending')))
      .returning();
    return toDto(ready ?? { ...row, status: 'ready', sizeBytes: head.sizeBytes });
  }

  async list(principal: Principal, taskId: string): Promise<AttachmentDto[]> {
    await requireTaskRole(this.db, principal.userId, taskId, REQUIRED_ROLE.readProject);
    const rows = await this.db
      .select()
      .from(attachments)
      .where(and(eq(attachments.taskId, taskId), eq(attachments.status, 'ready')))
      .orderBy(attachments.createdAt);
    return rows.map(toDto);
  }

  async download(principal: Principal, attachmentId: string): Promise<AttachmentDownloadDto> {
    const row = await this.#load(principal, attachmentId, REQUIRED_ROLE.readProject);
    if (row.status !== 'ready') throw notFound('Attachment');
    try {
      const url = await this.storage.createDownloadUrl({
        key: row.objectKey,
        filename: row.originalFilename,
        expiresSeconds: this.limits.downloadUrlTtlSeconds,
      });
      return {
        url,
        expiresAt: new Date(Date.now() + this.limits.downloadUrlTtlSeconds * 1000).toISOString(),
      };
    } catch {
      throw storageDown();
    }
  }

  /**
   * Deleting is two steps that cannot be atomic: hide the row (authoritative, immediate), then
   * delete the object. If the second fails, the sweep retries it. Repeating a delete is a no-op.
   */
  async delete(principal: Principal, attachmentId: string): Promise<void> {
    const row = await this.#load(principal, attachmentId, REQUIRED_ROLE.editTasks, true);
    if (row.status !== 'deleted') {
      await this.db
        .update(attachments)
        .set({ status: 'deleted', deletedAt: sql`now()` })
        .where(eq(attachments.id, row.id));
    }
    if (row.objectDeletedAt) return;
    try {
      await this.storage.delete(row.objectKey);
      await this.db
        .update(attachments)
        .set({ objectDeletedAt: sql`now()` })
        .where(eq(attachments.id, row.id));
    } catch {
      this.log.warn({ attachmentId }, 'object delete failed; the sweep will retry');
    }
  }

  /**
   * Converges metadata and objects (run periodically; one replica at a time via an advisory
   * lock). Abandoned pending uploads: delete the object if any, mark deleted. Deleted rows whose
   * object delete failed: retry. Returns how many rows were settled.
   */
  async sweep(limit = 100): Promise<number> {
    const due = await this.db.execute<{ id: string; object_key: string; status: string }>(sql`
      SELECT id, object_key, status FROM attachments
      WHERE (status = 'pending' AND created_at < now() - make_interval(secs => ${this.limits.pendingTtlSeconds}))
         OR (status = 'deleted' AND object_deleted_at IS NULL)
      ORDER BY created_at
      LIMIT ${limit}
    `);
    let settled = 0;
    for (const row of due.rows) {
      try {
        await this.storage.delete(row.object_key);
      } catch {
        continue; // storage still down: next sweep
      }
      await this.db.execute(sql`
        UPDATE attachments
        SET status = 'deleted', deleted_at = coalesce(deleted_at, now()), object_deleted_at = now()
        WHERE id = ${row.id}
      `);
      settled++;
    }
    if (settled > 0) this.log.info({ settled }, 'attachment sweep settled rows');
    return settled;
  }

  async #load(
    principal: Principal,
    attachmentId: string,
    role: (typeof REQUIRED_ROLE)[keyof typeof REQUIRED_ROLE],
    includeDeleted = false,
  ) {
    const [row] = await this.db.select().from(attachments).where(eq(attachments.id, attachmentId));
    if (!row || (!includeDeleted && row.status === 'deleted')) throw notFound('Attachment');
    // Access is decided by the attachment's task, like every other task resource.
    await requireTaskRole(this.db, principal.userId, row.taskId, role);
    return row;
  }
}
