import type { CancelSignal } from '../domain/cancel-signal.js';
import type { ChangeSet } from '../domain/change-set.js';
import type { ContextSelection } from '../domain/context-selection.js';
import type { AppError } from '../domain/errors.js';
import type { ChangeStatus } from '../domain/diff-hunk.js';
import type { Result } from '../domain/result.js';

export interface GitChangeEntry {
  readonly path: string;
  readonly originalPath?: string;
  readonly status: ChangeStatus;
  readonly staged: boolean;
}

export interface GitStatusSnapshot {
  readonly staged: readonly GitChangeEntry[];
  readonly unstaged: readonly GitChangeEntry[];
  readonly untracked: readonly GitChangeEntry[];
  readonly conflicted: readonly GitChangeEntry[];
}

export interface DiffStats {
  readonly files: number;
  readonly insertions: number;
  readonly deletions: number;
}

export interface UntrackedDiff {
  readonly text: string;
  readonly binary: boolean;
  readonly tooLarge: boolean;
}

/**
 * Narrow view over the VS Code Git extension for one repository.
 * Implementations live in `src/git`; core only sees this interface.
 */
export interface GitRepositoryPort {
  readonly rootPath: string;
  readonly repoName: string;
  readonly head: string | undefined;
  readonly branch: string | undefined;
  readonly isVirtualFileSystem: boolean;

  status(): GitStatusSnapshot;
  /** Unified diff of the index against HEAD for one path. */
  diffStaged(path: string, signal: CancelSignal): Promise<Result<string, AppError>>;
  /** Unified diff of the working tree against HEAD for one path. */
  diffWorking(path: string, signal: CancelSignal): Promise<Result<string, AppError>>;
  /** Unified diff for a file with no index entry. */
  diffUntracked(path: string, maxBytes: number, signal: CancelSignal): Promise<Result<UntrackedDiff, AppError>>;
  shortStats(path: string, signal: CancelSignal): Promise<Result<DiffStats, AppError>>;
  checkIgnore(paths: readonly string[]): Promise<Set<string>>;
}

export interface CollectorOptions {
  readonly selection: ContextSelection;
  readonly maxFiles: number;
  readonly maxFileBytes: number;
  readonly excludeGlobs: readonly string[];
  /** Per-session override for sensitive paths; never a persisted setting. */
  readonly allowSensitive: boolean;
}

export interface IDiffCollector {
  collect(options: CollectorOptions, signal: CancelSignal): Promise<Result<ChangeSet, AppError>>;
}
