import type { ChangeStatus, DiffHunk, Sensitivity } from './diff-hunk.js';

export interface FileChange {
  /** Repository-relative, POSIX separators. */
  readonly path: string;
  readonly oldPath?: string;
  readonly status: ChangeStatus;
  readonly staged: boolean;
  readonly insertions: number;
  readonly deletions: number;
  readonly isBinary: boolean;
  readonly hunks: readonly DiffHunk[];
  /** Lines removed from the diff by budgeting/truncation. */
  readonly omittedLines: number;
  readonly sensitivity: Sensitivity;
  readonly languageHint?: string;
}

export type OmissionReason = 'binary' | 'generated' | 'sensitive' | 'budget' | 'max-files' | 'too-large' | 'unsupported';

export interface OmittedFile {
  readonly path: string;
  readonly reason: OmissionReason;
  readonly detail?: string;
}

export function isSourceLike(path: string): boolean {
  const lower = path.toLowerCase();
  return !(
    lower.endsWith('.lock') ||
    lower.endsWith('.min.js') ||
    lower.endsWith('.min.css') ||
    lower.endsWith('.map') ||
    lower.endsWith('.snap') ||
    lower.endsWith('.svg') ||
    lower.endsWith('.png') ||
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.gif') ||
    lower.endsWith('.webp') ||
    lower.endsWith('.ico') ||
    lower.endsWith('.pdf') ||
    lower.endsWith('.woff') ||
    lower.endsWith('.woff2') ||
    lower.endsWith('.ttf')
  );
}
