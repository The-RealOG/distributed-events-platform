import {
  DeleteObjectCommand,
  HeadObjectCommand,
  S3Client,
  GetObjectCommand,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Binary content lives in object storage; PostgreSQL keeps only metadata (ADR-021). The API is a
 * control plane: it signs short-lived, narrowly scoped requests and the browser moves the bytes
 * to and from S3 directly.
 */
export interface ObjectStorage {
  /**
   * A presigned POST for exactly one key: S3 itself rejects a different key, a different
   * Content-Type, or a body outside [1, maxBytes].
   */
  createUpload(input: {
    key: string;
    contentType: string;
    maxBytes: number;
    expiresSeconds: number;
  }): Promise<{ url: string; fields: Record<string, string> }>;
  /** A presigned GET that downloads as an attachment with the given file name. */
  createDownloadUrl(input: {
    key: string;
    filename: string;
    expiresSeconds: number;
  }): Promise<string>;
  /** Size and content type of a stored object, or null if it does not exist. */
  head(key: string): Promise<{ sizeBytes: number; contentType: string | undefined } | null>;
  /** Idempotent: deleting a missing object succeeds. */
  delete(key: string): Promise<void>;
}

export interface S3StorageOptions {
  bucket: string;
  region: string;
  /** S3-compatible endpoint (MinIO locally); omitted for AWS. */
  endpoint?: string | undefined;
  /**
   * Endpoint browsers use, if it differs from the one this service uses (local MinIO:
   * http://localhost:9000 vs http://minio:9000). Presigned URLs are signed for this host.
   */
  publicEndpoint?: string | undefined;
  forcePathStyle?: boolean;
  credentials?: S3ClientConfig['credentials'];
  /** Upper bound on any S3 call, so an S3 outage fails attachment requests fast. */
  requestTimeoutMs?: number;
}

export class StorageUnavailableError extends Error {
  constructor(cause: unknown) {
    super('Object storage is unavailable', { cause });
    this.name = 'StorageUnavailableError';
  }
}

export class S3ObjectStorage implements ObjectStorage {
  readonly #bucket: string;
  readonly #client: S3Client;
  readonly #signer: S3Client;

  constructor(options: S3StorageOptions) {
    this.#bucket = options.bucket;
    const base: S3ClientConfig = {
      region: options.region,
      forcePathStyle: options.forcePathStyle ?? false,
      maxAttempts: 2,
      requestHandler: {
        requestTimeout: options.requestTimeoutMs ?? 3_000,
        connectionTimeout: 2_000,
      },
      ...(options.credentials ? { credentials: options.credentials } : {}),
    };
    this.#client = new S3Client({
      ...base,
      ...(options.endpoint ? { endpoint: options.endpoint } : {}),
    });
    const publicEndpoint = options.publicEndpoint ?? options.endpoint;
    this.#signer = new S3Client({
      ...base,
      ...(publicEndpoint ? { endpoint: publicEndpoint } : {}),
    });
  }

  async createUpload(input: {
    key: string;
    contentType: string;
    maxBytes: number;
    expiresSeconds: number;
  }) {
    return createPresignedPost(this.#signer, {
      Bucket: this.#bucket,
      Key: input.key,
      Conditions: [
        ['content-length-range', 1, input.maxBytes],
        ['eq', '$Content-Type', input.contentType],
      ],
      Fields: { 'Content-Type': input.contentType },
      Expires: input.expiresSeconds,
    });
  }

  async createDownloadUrl(input: { key: string; filename: string; expiresSeconds: number }) {
    return getSignedUrl(
      this.#signer,
      new GetObjectCommand({
        Bucket: this.#bucket,
        Key: input.key,
        ResponseContentDisposition: contentDisposition(input.filename),
      }),
      { expiresIn: input.expiresSeconds },
    );
  }

  async head(key: string) {
    try {
      const out = await this.#client.send(
        new HeadObjectCommand({ Bucket: this.#bucket, Key: key }),
      );
      return { sizeBytes: out.ContentLength ?? 0, contentType: out.ContentType };
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404) return null;
      throw new StorageUnavailableError(err);
    }
  }

  async delete(key: string) {
    try {
      await this.#client.send(new DeleteObjectCommand({ Bucket: this.#bucket, Key: key }));
    } catch (err) {
      throw new StorageUnavailableError(err);
    }
  }
}

/** attachment; filename="safe ascii"; filename*=UTF-8''percent-encoded (RFC 6266). */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
