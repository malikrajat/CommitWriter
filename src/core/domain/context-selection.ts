import type { ChangeScope } from './change-set.js';

/** Independent user controls for which changes take part in a run. */
export interface ContextSelection {
  readonly includeStaged: boolean;
  readonly includeUnstaged: boolean;
  readonly includeUntracked: boolean;
}

export function hasSelection(selection: ContextSelection): boolean {
  return selection.includeStaged || selection.includeUnstaged || selection.includeUntracked;
}

/** Human-readable scope label used in messages and the change set. */
export function selectionLabel(selection: ContextSelection): ChangeScope {
  if (selection.includeStaged && (selection.includeUnstaged || selection.includeUntracked)) {
    return 'all';
  }
  if (selection.includeStaged) {
    return 'staged';
  }
  return 'unstaged';
}
