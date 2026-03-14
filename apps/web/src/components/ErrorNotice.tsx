import { Link } from 'react-router';
import { describeError, isApiError } from '../lib/api/errors';

/**
 * Page- or section-level error with a response that fits the failure: retry for transient
 * problems, a way out for missing or forbidden resources.
 */
export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const transient = isApiError(error, 'unavailable') || isApiError(error, 'network');
  const gone = isApiError(error, 'not_found') || isApiError(error, 'forbidden');
  return (
    <div role="alert" className="notice notice-error">
      <p>{describeError(error)}</p>
      {transient && onRetry && (
        <button type="button" onClick={onRetry}>
          Try again
        </button>
      )}
      {gone && <Link to="/workspaces">Back to workspaces</Link>}
    </div>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <p role="status" className="muted">
      {label}…
    </p>
  );
}
