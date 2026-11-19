import type { ChangeStatus } from '../domain/diff-hunk.js';
import type { FileChange } from '../domain/file-change.js';
import type { PromptSegment } from '../domain/budget.js';

const STATUS_LETTER: Readonly<Record<ChangeStatus, string>> = {
  added: 'A',
  untracked: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  typechange: 'T',
  conflicted: 'U',
};

export function manifestLine(file: FileChange): string {
  const letter = STATUS_LETTER[file.status];
  const staged = file.staged ? '' : ' (unstaged)';
  const renamed = file.oldPath ? ` <- ${file.oldPath}` : '';
  return `${letter} ${file.path} +${file.insertions} -${file.deletions}${renamed}${staged}`;
}

/** Manifest line for a budgeted segment (used by chunk-scoped prompts). */
export function segmentManifestLine(segment: PromptSegment): string {
  const letter = STATUS_LETTER[segment.status];
  const staged = segment.staged ? '' : ' (unstaged)';
  return `${letter} ${segment.path} +${segment.insertions} -${segment.deletions}${staged}`;
}

/**
 * The manifest is always sent, even when every diff is truncated, so the model
 * can never claim a change that does not exist.
 */
export function buildManifest(files: readonly FileChange[], limit = 500): readonly string[] {
  const included = files.slice(0, limit).map(manifestLine);
  if (files.length > limit) {
    included.push(`(+${files.length - limit} more files not listed)`);
  }
  return included;
}
