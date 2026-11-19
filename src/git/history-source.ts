import { appError, type AppError } from '../core/domain/errors.js';
import type { CancelSignal } from '../core/domain/cancel-signal.js';
import { ok, type Result } from '../core/domain/result.js';
import type { IHistorySource } from '../core/ports/i-history-source.js';
import { withDeadline } from './deadline.js';
import type { GitRepository } from './git-types.js';

export class GitHistorySource implements IHistorySource {
  constructor(private readonly repository: GitRepository) {}

  async recentSubjects(limit: number, signal: CancelSignal): Promise<Result<readonly string[], AppError>> {
    if (limit <= 0) {
      return ok([]);
    }
    const result = await withDeadline(this.repository.log({ maxEntries: Math.min(limit, 100) }), signal, 10000, () =>
      appError('timeout', 'Git history did not load in time.'),
    );
    if (!result.ok) {
      return result;
    }
    const subjects = result.value
      .map((commit) => commit.message.split('\n')[0]?.trim() ?? '')
      .filter((subject) => subject.length > 0 && subject.length <= 120);
    return ok(subjects);
  }
}
