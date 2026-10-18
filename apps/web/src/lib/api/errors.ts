import { errorBodySchema, type ErrorCode } from '@dpp/contracts';

export type ApiErrorKind =
  | 'validation'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'version_conflict'
  | 'conflict'
  | 'payload_too_large'
  | 'unavailable'
  | 'outcome_unknown'
  | 'network'
  | 'unexpected';

/**
 * Every failure the API client can produce. Components branch on `kind`, never on raw status
 * codes or message text. `message` is always safe to show: it's either the server's public
 * message (which the backend guarantees is safe) or a local fallback.
 */
export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    message: string,
    readonly status: number | null,
    readonly code?: ErrorCode,
    readonly details?: Record<string, unknown>,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** For VERSION_CONFLICT: the server's version at the time of the conflict. */
  get currentVersion(): number | undefined {
    const value = this.details?.['currentVersion'];
    return typeof value === 'number' ? value : undefined;
  }
}

const FALLBACK_MESSAGES: Record<ApiErrorKind, string> = {
  validation: 'Some of the information entered is invalid.',
  unauthenticated: 'Your session has ended. Please sign in again.',
  forbidden: 'You don’t have permission to do that.',
  not_found: 'This item no longer exists.',
  version_conflict: 'This was changed by someone else since you loaded it.',
  conflict: 'That conflicts with the current state.',
  payload_too_large: 'That is too large to send.',
  unavailable: 'The service is temporarily unavailable. Please try again shortly.',
  outcome_unknown: 'The request timed out and may have been saved. Refresh before trying again.',
  network: 'Can’t reach the server. Check your connection and try again.',
  unexpected: 'Something unexpected happened. Please try again.',
};

function kindFromCode(code: ErrorCode): ApiErrorKind {
  switch (code) {
    case 'VALIDATION_FAILED':
    case 'BAD_REQUEST':
    case 'UNSUPPORTED_MEDIA_TYPE':
      return 'validation';
    case 'UNAUTHENTICATED':
    case 'TOKEN_EXPIRED':
      return 'unauthenticated';
    case 'FORBIDDEN':
      return 'forbidden';
    case 'NOT_FOUND':
      return 'not_found';
    case 'VERSION_CONFLICT':
      return 'version_conflict';
    case 'CONFLICT':
    case 'UPLOAD_INCOMPLETE':
      return 'conflict';
    case 'PAYLOAD_TOO_LARGE':
      return 'payload_too_large';
    case 'DEPENDENCY_UNAVAILABLE':
      return 'unavailable';
    case 'OUTCOME_UNKNOWN':
      return 'outcome_unknown';
    case 'INTERNAL':
      return 'unexpected';
  }
}

function kindFromStatus(status: number): ApiErrorKind {
  if (status === 400 || status === 422) return 'validation';
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 413) return 'payload_too_large';
  if (status === 502 || status === 503 || status === 504) return 'unavailable';
  return 'unexpected';
}

/** Converts a non-2xx response into an ApiError without ever surfacing raw bodies. */
export function toApiError(status: number, body: unknown): ApiError {
  const parsed = errorBodySchema.safeParse(body);
  if (!parsed.success) {
    const kind = kindFromStatus(status);
    return new ApiError(kind, FALLBACK_MESSAGES[kind], status);
  }
  const { code, message, details, requestId } = parsed.data.error;
  const kind = kindFromCode(code);
  // Server messages for internal errors are generic anyway; prefer our wording for them.
  const safeMessage = kind === 'unexpected' ? FALLBACK_MESSAGES.unexpected : message;
  return new ApiError(kind, safeMessage, status, code, details, requestId);
}

export function networkError(): ApiError {
  return new ApiError('network', FALLBACK_MESSAGES.network, null);
}

export function unexpectedResponse(status: number): ApiError {
  return new ApiError('unexpected', FALLBACK_MESSAGES.unexpected, status);
}

/** User-facing sentence for any thrown value. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.kind === 'validation' || error.kind === 'conflict' || error.kind === 'unavailable'
      ? error.message
      : FALLBACK_MESSAGES[error.kind];
  }
  return FALLBACK_MESSAGES.unexpected;
}

export const isApiError = (error: unknown, kind?: ApiErrorKind): error is ApiError =>
  error instanceof ApiError && (kind === undefined || error.kind === kind);
