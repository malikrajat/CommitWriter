import * as path from 'node:path';
import type { CancelSignal } from '../core/domain/cancel-signal.js';
import type { ChangeSet } from '../core/domain/change-set.js';
import type { AppError } from '../core/domain/errors.js';
import type { FileChange, OmittedFile } from '../core/domain/file-change.js';
import { isSourceLike } from '../core/domain/file-change.js';
import { err, ok, type Result } from '../core/domain/result.js';
import { matchesAny, PROTECTED_EXCLUDES } from '../core/context/exclusion-policy.js';
import { parseUnifiedDiff } from '../core/context/diff-normalizer.js';
import { classifyPath } from '../core/security/sensitive-path-policy.js';
import type { CollectorOptions, GitRepositoryPort, IDiffCollector } from '../core/ports/i-git.js';
import type { ILogger } from '../core/ports/i-logger.js';
import { mapConcurrent } from './concurrency-pool.js';
import { selectEntries, type SelectedEntry } from './change-selection.js';
import { selectionLabel } from '../core/domain/context-selection.js';

const CONCURRENCY = 6;

type ReadOutcome =
  | { readonly kind: 'file'; readonly file: FileChange }
  | { readonly kind: 'omitted'; readonly omitted: OmittedFile }
  | { readonly kind: 'error'; readonly error: AppError };

export class VscodeDiffCollector implements IDiffCollector {
  constructor(
    private readonly repository: GitRepositoryPort,
    private readonly logger: ILogger,
  ) {}

  async collect(options: CollectorOptions, signal: CancelSignal): Promise<Result<ChangeSet, AppError>> {
    const snapshot = this.repository.status();
    const selection = selectEntries(snapshot, options);
    const globs = [...PROTECTED_EXCLUDES, ...options.excludeGlobs];
    const omitted: OmittedFile[] = [];
    const accepted: SelectedEntry[] = [];
    const collectionCap = Math.max(1, options.maxFiles) * 2;

    for (const item of selection) {
      const matched = matchesAny(item.entry.path, globs);
      if (matched) {
        omitted.push({ path: item.entry.path, reason: 'generated', detail: `matched ${matched}` });
        continue;
      }

      const verdict = classifyPath(item.entry.path);
      if (verdict.sensitivity === 'blocked' && !options.allowSensitive) {
        omitted.push({ path: item.entry.path, reason: 'sensitive', detail: verdict.label });
        continue;
      }

      if (accepted.length >= collectionCap) {
        omitted.push({ path: item.entry.path, reason: 'max-files' });
        continue;
      }

      accepted.push(item);
    }

    const outcomes = await mapConcurrent(accepted, CONCURRENCY, (item) =>
      this.readOne(item, options, signal),
    );

    const files: FileChange[] = [];
    for (const outcome of outcomes) {
      if (outcome.kind === 'error') {
        if (outcome.error.code === 'cancelled') {
          return err(outcome.error);
        }
        this.logger.warn('skipping unreadable change', { code: outcome.error.code });
        continue;
      }
      if (outcome.kind === 'omitted') {
        omitted.push(outcome.omitted);
        continue;
      }
      files.push(outcome.file);
    }

    files.sort((a, b) => (a.path < b.path ? -1 : 1));

    const counts = {
      files: files.length,
      insertions: files.reduce((total, file) => total + file.insertions, 0),
      deletions: files.reduce((total, file) => total + file.deletions, 0),
      staged: files.filter((file) => file.staged).length,
      untracked: files.filter((file) => file.status === 'untracked').length,
    };

    return ok({
      repoRoot: this.repository.rootPath,
      repoName: this.repository.repoName,
      scope: selectionLabel(options.selection),
      head: this.repository.head,
      branch: this.repository.branch,
      files,
      omitted,
      counts,
      truncatedFiles: 0,
      collectedAt: Date.now(),
    });
  }

  private async readOne(
    item: SelectedEntry,
    options: CollectorOptions,
    signal: CancelSignal,
  ): Promise<ReadOutcome> {
    const { entry, mode } = item;
    const verdict = classifyPath(entry.path);
    let text: string;
    let binary = false;
    let tooLarge = false;

    if (mode === 'untracked') {
      const result = await this.repository.diffUntracked(entry.path, options.maxFileBytes, signal);
      if (!result.ok) {
        return result.error.code === 'cancelled'
          ? { kind: 'error', error: result.error }
          : { kind: 'omitted', omitted: { path: entry.path, reason: 'unsupported', detail: result.error.code } };
      }
      text = result.value.text;
      binary = result.value.binary;
      tooLarge = result.value.tooLarge;
    } else {
      const result =
        mode === 'staged'
          ? await this.repository.diffStaged(entry.path, signal)
          : await this.repository.diffWorking(entry.path, signal);
      if (!result.ok) {
        return result.error.code === 'cancelled'
          ? { kind: 'error', error: result.error }
          : { kind: 'omitted', omitted: { path: entry.path, reason: 'unsupported', detail: result.error.code } };
      }
      text = result.value;
      if (text.length > options.maxFileBytes * 4) {
        tooLarge = true;
      }
    }

    if (tooLarge) {
      return { kind: 'omitted', omitted: { path: entry.path, reason: 'too-large' } };
    }

    const parsed = parseUnifiedDiff(text);
    const extension = path.extname(entry.path).replace(/^\./, '');

    return {
      kind: 'file',
      file: {
        path: entry.path,
        oldPath: entry.originalPath,
        status: entry.status,
        staged: mode === 'staged',
        insertions: parsed.insertions,
        deletions: parsed.deletions,
        isBinary: binary || parsed.isBinary,
        hunks: parsed.hunks,
        omittedLines: 0,
        sensitivity: verdict.sensitivity,
        languageHint: isSourceLike(entry.path) && extension.length > 0 ? extension : undefined,
      },
    };
  }
}
