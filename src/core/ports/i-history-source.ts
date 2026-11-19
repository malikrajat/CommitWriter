import type { CancelSignal } from '../domain/cancel-signal.js';
import type { Result } from '../domain/result.js';
import type { AppError } from '../domain/errors.js';

export interface IHistorySource {
  /** Recent commit subjects only (no bodies, no diffs). */
  recentSubjects(limit: number, signal: CancelSignal): Promise<Result<readonly string[], AppError>>;
}
