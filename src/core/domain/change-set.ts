import type { FileChange, OmittedFile } from './file-change.js';
export type ChangeScope = 'staged' | 'unstaged' | 'all';

export interface ChangeCounts {
  readonly files: number;
  readonly insertions: number;
  readonly deletions: number;
  readonly staged: number;
  readonly untracked: number;
}

export interface ChangeSet {
  readonly repoRoot: string;
  readonly repoName: string;
  readonly scope: ChangeScope;
  readonly head?: string;
  readonly branch?: string;
  readonly files: readonly FileChange[];
  readonly omitted: readonly OmittedFile[];
  readonly counts: ChangeCounts;
  readonly truncatedFiles: number;
  readonly collectedAt: number;
}
