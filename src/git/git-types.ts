import type { Event, Uri } from 'vscode';

/** Minimal structural types for the subset of `vscode.git` API v1 we use. */

export interface GitChange {
  readonly uri: Uri;
  readonly originalUri: Uri;
  readonly renameUri?: Uri;
  readonly status: number;
}

export interface GitRepositoryState {
  readonly HEAD?: { readonly name?: string; readonly commit?: string };
  readonly indexChanges: readonly GitChange[];
  readonly workingTreeChanges: readonly GitChange[];
  readonly untrackedChanges: readonly GitChange[];
  readonly mergeChanges: readonly GitChange[];
  readonly onDidChange: Event<void>;
}

export interface GitRepository {
  readonly rootUri: Uri;
  readonly inputBox: { value: string };
  readonly kind: string;
  readonly isUsingVirtualFileSystem: boolean;
  readonly state: GitRepositoryState;
  readonly ui: { readonly selected: boolean; readonly onDidChange: Event<void> };
  diffIndexWithHEAD(path: string): Promise<string>;
  diffWithHEAD(path: string): Promise<string>;
  diffWithHEADShortStats?(path?: string): Promise<{ files: number; insertions: number; deletions: number }>;
  checkIgnore(paths: string[]): Promise<Set<string>>;
  log(options?: { maxEntries?: number }): Promise<readonly { readonly message: string }[]>;
}

export interface GitAPI {
  readonly state: 'uninitialized' | 'initialized';
  readonly onDidChangeState: Event<'uninitialized' | 'initialized'>;
  readonly repositories: readonly GitRepository[];
  readonly git: { readonly path: string };
  getRepository(uri: Uri): GitRepository | null;
  init(root: Uri, options?: { defaultBranch?: string }): Promise<GitRepository | null>;
}

export interface GitExtensionExports {
  readonly enabled: boolean;
  readonly onDidChangeEnablement: Event<boolean>;
  getAPI(version: 1): GitAPI;
}

/** Values from the git extension's `Status` enum. */
export const GIT_STATUS = {
  INDEX_MODIFIED: 0,
  INDEX_ADDED: 1,
  INDEX_DELETED: 2,
  INDEX_RENAMED: 3,
  INDEX_COPIED: 4,
  MODIFIED: 5,
  DELETED: 6,
  UNTRACKED: 7,
  IGNORED: 8,
  INTENT_TO_ADD: 9,
  INTENT_TO_RENAME: 10,
  TYPE_CHANGED: 11,
  MERGE_START: 12,
} as const;
