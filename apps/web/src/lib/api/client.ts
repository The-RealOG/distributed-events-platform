import type { z } from 'zod';
import type { ApiError } from './errors';
import { networkError, toApiError, unexpectedResponse } from './errors';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface ApiClientOptions {
  baseUrl: string;
  getToken: () => string | null;
  /** Called once per 401 so the app can end the session; the error is still thrown. */
  onUnauthenticated: (error: ApiError) => void;
  fetchImpl?: typeof fetch;
}

export interface RequestOptions<S extends z.ZodType | undefined> {
  body?: unknown;
  /** Runtime check of the response. Omit only for endpoints that return no body (204). */
  schema?: S;
  signal?: AbortSignal | undefined;
}

type Result<S> = S extends z.ZodType ? z.infer<S> : undefined;

/**
 * The single place the browser talks HTTP. Owns the base URL, auth header, correlation IDs,
 * JSON handling and translation of every failure into an ApiError.
 */
export class ApiClient {
  constructor(private readonly options: ApiClientOptions) {}

  async request<S extends z.ZodType | undefined = undefined>(
    method: HttpMethod,
    path: string,
    { body, schema, signal }: RequestOptions<S> = {},
  ): Promise<Result<S>> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      // One ID per logical operation, so the gateway and services can be correlated.
      'x-correlation-id': crypto.randomUUID(),
    };
    const token = this.options.getToken();
    if (token) headers['authorization'] = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';

    const fetchImpl = this.options.fetchImpl ?? fetch;
    let response: Response;
    try {
      response = await fetchImpl(`${this.options.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? null : JSON.stringify(body),
        signal: signal ?? null,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      throw networkError();
    }

    const text = await response.text().catch(() => '');
    let payload: unknown = undefined;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = undefined;
      }
    }

    if (!response.ok) {
      const error = toApiError(response.status, payload);
      if (error.kind === 'unauthenticated') this.options.onUnauthenticated(error);
      throw error;
    }

    if (!schema) return undefined as Result<S>;
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw unexpectedResponse(response.status);
    return parsed.data as Result<S>;
  }
}
