import type { CancelSignal } from '../domain/cancel-signal.js';
import type { AppError } from '../domain/errors.js';
import type { Result } from '../domain/result.js';

export interface HttpRequest {
  readonly url: string;
  readonly method: 'GET' | 'POST' | 'DELETE';
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly timeoutMs: number;
  readonly signal: CancelSignal;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly text: string;
}

/**
 * The single network choke point. Every byte that leaves the machine passes
 * through an implementation of this port (redaction, URL policy, timeout,
 * abort wiring live behind it).
 */
export interface IHttpClient {
  send(request: HttpRequest): Promise<Result<HttpResponse, AppError>>;
}
