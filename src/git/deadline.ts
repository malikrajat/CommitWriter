import { appError, toAppError, type AppError } from '../core/domain/errors.js';
import type { CancelSignal } from '../core/domain/cancel-signal.js';
import { err, ok, type Result } from '../core/domain/result.js';

/**
 * The Git extension does not accept cancellation tokens for diff operations.
 * We race the platform promise against cancellation and a deadline, then
 * discard the losing result. The underlying git process finishes in the
 * background; nothing observes it.
 */
export function withDeadline<T>(
  operation: Promise<T>,
  signal: CancelSignal,
  timeoutMs: number,
  timeoutError: () => AppError,
): Promise<Result<T, AppError>> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let subscription: { dispose(): void } | undefined;

    const finish = (result: Result<T, AppError>): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      subscription?.dispose();
      resolve(result);
    };

    if (signal.aborted) {
      finish(err(appError('cancelled', 'Generation cancelled.')));
      return;
    }

    timer = setTimeout(() => finish(err(timeoutError())), timeoutMs);
    subscription = signal.onAbort(() => finish(err(appError('cancelled', 'Generation cancelled.'))));

    operation.then(
      (value) => finish(ok(value)),
      (error: unknown) => finish(err(toAppError(error, 'Git operation failed.'))),
    );
  });
}
