export type ErrorCode =
  | 'config'
  | 'git_disabled'
  | 'no_repository'
  | 'no_changes'
  | 'profile_missing'
  | 'profile_invalid'
  | 'secret_missing'
  | 'consent_required'
  | 'url_rejected'
  | 'auth'
  | 'rate_limit'
  | 'quota'
  | 'timeout'
  | 'network'
  | 'tls'
  | 'bad_request'
  | 'context_overflow'
  | 'content_filter'
  | 'server'
  | 'cancelled'
  | 'invalid_response'
  | 'write_failed'
  | 'internal';

/**
 * User-facing error. `message` is already safe to display: it never contains
 * credentials, prompt text, diff text or raw provider response bodies.
 */
export interface AppError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly httpStatus?: number;
  readonly providerId?: string;
  readonly model?: string;
  readonly requestId?: string;
  readonly cause?: string;
}

export function appError(
  code: ErrorCode,
  message: string,
  extra: Omit<Partial<AppError>, 'code' | 'message'> = {},
): AppError {
  return { code, message, retryable: extra.retryable ?? false, ...extra };
}

export function isCancelled(error: AppError | undefined): boolean {
  return error?.code === 'cancelled';
}

export function isAppError(value: unknown): value is AppError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AppError).code === 'string' &&
    typeof (value as AppError).message === 'string'
  );
}

export function toAppError(value: unknown, fallbackMessage: string): AppError {
  if (isAppError(value)) {
    return value;
  }
  if (value instanceof Error) {
    return appError('internal', fallbackMessage, { cause: value.name });
  }
  return appError('internal', fallbackMessage);
}
