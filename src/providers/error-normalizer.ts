import { appError, type AppError } from '../core/domain/errors.js';
import { redactSecrets } from '../core/security/secret-redactor.js';

const CONTEXT_OVERFLOW =
  /context length|context window|too many tokens|maximum context|token limit|input is too long|prompt is too long|exceeds the maximum|request too large/i;
const QUOTA = /quota|billing|insufficient|credit|payment|out of budget/i;

function snippet(detail: string): string | undefined {
  const redacted = redactSecrets(detail).text.replace(/\s+/g, ' ').trim();
  if (redacted.length === 0) {
    return undefined;
  }
  return redacted.slice(0, 160);
}

/**
 * Maps an HTTP failure to the normalized error taxonomy. Provider text is
 * never placed into `message`; at most a short redacted snippet becomes `cause`.
 */
export function normalizeProviderError(input: {
  readonly status: number;
  readonly detail: string;
  readonly providerId: string;
  readonly model?: string;
}): AppError {
  const { status, detail, providerId, model } = input;
  const base = { providerId, httpStatus: status, model, cause: snippet(detail) };

  if (status === 401 || status === 403) {
    if (QUOTA.test(detail)) {
      return appError('quota', 'The provider rejected the request: quota or billing limit reached.', base);
    }
    return appError('auth', 'Authentication failed. Check the API key for this profile.', base);
  }
  if (status === 429) {
    if (QUOTA.test(detail)) {
      return appError('quota', 'The provider reports no remaining quota.', base);
    }
    return appError('rate_limit', 'The provider is rate limiting requests. Try again shortly.', {
      ...base,
      retryable: true,
    });
  }
  if (status === 413 || CONTEXT_OVERFLOW.test(detail)) {
    return appError('context_overflow', 'The change set is too large for this model.', base);
  }
  if (status === 404) {
    return appError('bad_request', `Model "${model ?? 'unknown'}" was not found on this endpoint.`, base);
  }
  if (status >= 500) {
    return appError('server', 'The provider returned a server error.', { ...base, retryable: true });
  }
  return appError('bad_request', `The provider rejected the request (HTTP ${status}).`, base);
}
