import * as path from 'node:path';
import type { Uri } from 'vscode';
import type { CancelSignal } from '../core/domain/cancel-signal.js';
import { appError, type AppError } from '../core/domain/errors.js';
import type { ChangeStatus } from '../core/domain/diff-hunk.js';
import { ok, type Result } from '../core/domain/result.js';
import { parseUnifiedDiff } from '../core/context/diff-normalizer.js';
import type {
  DiffStats,
  GitChangeEntry,
  GitRepositoryPort,
  GitStatusSnapshot,
  UntrackedDiff,
} from '../core/ports/i-git.js';
import { withDeadline } from './deadline.js';
import { probeCapabilities } from './capability-probe.js';
import type { FileReader } from './file-reader.js';
import { GIT_STATUS, type GitChange, type GitRepository } from './git-types.js';
import { readUntrackedDiff } from './untracked-diff.js';

const DIFF_TIMEOUT_MS = 15000;

function mapStatus(status: number): ChangeStatus {
  switch (status) {
    case GIT_STATUS.INDEX_MODIFIED:
    case GIT_STATUS.MODIFIED:
      return 'modified';
    case GIT_STATUS.INDEX_ADDED:
    case GIT_STATUS.INTENT_TO_ADD:
      return 'added';
    case GIT_STATUS.INDEX_DELETED:
    case GIT_STATUS.DELETED:
      return 'deleted';
    case GIT_STATUS.INDEX_RENAMED:
    case GIT_STATUS.INTENT_TO_RENAME:
      return 'renamed';
    case GIT_STATUS.INDEX_COPIED:
      return 'copied';
    case GIT_STATUS.UNTRACKED:
      return 'untracked';
    case GIT_STATUS.TYPE_CHANGED:
      return 'typechange';
    default:
      return status >= GIT_STATUS.MERGE_START ? 'conflicted' : 'modified';
  }
}

export class VscodeGitRepository implements GitRepositoryPort {
  constructor(
    private readonly repository: GitRepository,
    private readonly reader: FileReader,
  ) {}

  get rootPath(): string {
    return this.repository.rootUri.fsPath;
  }

  get repoName(): string {
    return path.basename(this.rootPath);
  }

  get head(): string | undefined {
    return this.repository.state.HEAD?.commit;
  }

  get branch(): string | undefined {
    return this.repository.state.HEAD?.name;
  }

  get isVirtualFileSystem(): boolean {
    return this.repository.isUsingVirtualFileSystem === true;
  }

  status(): GitStatusSnapshot {
    const state = this.repository.state;

    const convert = (change: GitChange, staged: boolean): GitChangeEntry => ({
      path: this.toRelativePath(change.uri),
      originalPath: change.renameUri ? this.toRelativePath(change.renameUri) : undefined,
      status: mapStatus(change.status),
      staged,
    });

    return {
      staged: state.indexChanges
        .filter((change) => change.status !== GIT_STATUS.IGNORED)
        .map((change) => convert(change, true)),
      unstaged: state.workingTreeChanges
        .filter((change) => change.status !== GIT_STATUS.IGNORED)
        .map((change) => convert(change, false)),
      untracked: state.untrackedChanges
        .filter((change) => change.status !== GIT_STATUS.IGNORED)
        .map((change) => convert(change, false)),
      conflicted: state.mergeChanges.map((change) => ({
        path: this.toRelativePath(change.uri),
        originalPath: undefined,
        status: 'conflicted' as ChangeStatus,
        staged: false,
      })),
    };
  }

  async diffStaged(relativePath: string, signal: CancelSignal): Promise<Result<string, AppError>> {
    return this.diffWith((target) => this.repository.diffIndexWithHEAD(target), relativePath, signal);
  }

  async diffWorking(relativePath: string, signal: CancelSignal): Promise<Result<string, AppError>> {
    return this.diffWith((target) => this.repository.diffWithHEAD(target), relativePath, signal);
  }

  async diffUntracked(
    relativePath: string,
    maxBytes: number,
    signal: CancelSignal,
  ): Promise<Result<UntrackedDiff, AppError>> {
    return readUntrackedDiff({
      reader: this.reader,
      relativePath,
      absolutePath: path.join(this.rootPath, relativePath),
      maxBytes,
      signal,
    });
  }

  async shortStats(relativePath: string, signal: CancelSignal): Promise<Result<DiffStats, AppError>> {
    const supportsStats =
      probeCapabilities(this.repository).shortStats &&
      typeof this.repository.diffWithHEADShortStats === 'function';

    if (supportsStats && this.repository.diffWithHEADShortStats) {
      const stats = await withDeadline(
        this.repository.diffWithHEADShortStats(path.join(this.rootPath, relativePath)),
        signal,
        DIFF_TIMEOUT_MS,
        () => appError('timeout', 'Git did not return diff statistics in time.'),
      );
      if (stats.ok) {
        return ok({
          files: stats.value.files,
          insertions: stats.value.insertions,
          deletions: stats.value.deletions,
        });
      }
      if (stats.error.code === 'cancelled') {
        return stats;
      }
    }

    const diff = await this.diffWorking(relativePath, signal);
    if (!diff.ok) {
      return diff;
    }
    const parsed = parseUnifiedDiff(diff.value);
    return ok({ files: 1, insertions: parsed.insertions, deletions: parsed.deletions });
  }

  async checkIgnore(paths: readonly string[]): Promise<Set<string>> {
    try {
      return await this.repository.checkIgnore([...paths]);
    } catch {
      return new Set<string>();
    }
  }

  private async diffWith(
    operation: (target: string) => Promise<string>,
    relativePath: string,
    signal: CancelSignal,
  ): Promise<Result<string, AppError>> {
    const relative = await withDeadline(operation(relativePath), signal, DIFF_TIMEOUT_MS, () =>
      appError('timeout', 'Git did not return a diff in time.'),
    );
    if (relative.ok || relative.error.code === 'cancelled') {
      return relative;
    }

    // Some VS Code versions expect an absolute path here.
    const absolute = path.join(this.rootPath, relativePath);
    return withDeadline(operation(absolute), signal, DIFF_TIMEOUT_MS, () =>
      appError('timeout', 'Git did not return a diff in time.'),
    );
  }

  private toRelativePath(uri: Uri): string {
    const root = this.rootPath.replace(/\\/g, '/').replace(/\/$/, '');
    const absolute = uri.fsPath.replace(/\\/g, '/');
    if (absolute === root) {
      return '';
    }
    if (absolute.startsWith(`${root}/`)) {
      return absolute.slice(root.length + 1);
    }
    return path.relative(this.rootPath, uri.fsPath).replace(/\\/g, '/');
  }
}
