import type { AppError } from '../core/domain/errors.js';

export const MAX_BACKOFF_MS = 8000;
const BASE_DELAY_MS = 500;

export function parseRetryAfterMs(headers: Readonly<Record<string, string>>): number | undefined {
  const raw = headers['retry-after'];
  if (!raw) {
    return undefined;
  }
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(MAX_BACKOFF_MS, seconds * 1000);
  }
  const date = Date.parse(raw);
  if (Number.isFinite(date)) {
    return Math.min(MAX_BACKOFF_MS, Math.max(0, date - Date.now()));
  }
  return undefined;
}

export function shouldRetry(error: AppError, attempt: number, maxRetries: number): boolean {
  return error.retryable && attempt < maxRetries;
}

export function backoffMs(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined) {
    return retryAfterMs;
  }
  const exponential = BASE_DELAY_MS * 2 ** Math.max(0, attempt);
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(MAX_BACKOFF_MS, exponential + jitter);
}
