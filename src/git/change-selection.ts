import type { CollectorOptions, GitChangeEntry, GitStatusSnapshot } from '../core/ports/i-git.js';

export type ChangeMode = 'staged' | 'working' | 'untracked';

export interface SelectedEntry {
  readonly entry: GitChangeEntry;
  readonly mode: ChangeMode;
}

/**
 * Pure selection step driven by three independent user controls.
 *
 *  - Staged: the Git index (HEAD -> index diff).
 *  - Unstaged: the working tree, including merge conflicts.
 *  - Untracked: files with no index entry.
 *
 * When both staged and unstaged are enabled, a path present in both is diffed
 * against HEAD so a single patch covers both sides.
 */
export function selectEntries(
  snapshot: GitStatusSnapshot,
  options: CollectorOptions,
): readonly SelectedEntry[] {
  const map = new Map<string, SelectedEntry>();
  const { selection } = options;

  if (selection.includeStaged) {
    for (const entry of snapshot.staged) {
      map.set(entry.path, { entry, mode: 'staged' });
    }
  }

  if (selection.includeUnstaged) {
    for (const entry of snapshot.unstaged) {
      map.set(entry.path, { entry, mode: 'working' });
    }
    for (const entry of snapshot.conflicted) {
      map.set(entry.path, { entry, mode: 'working' });
    }
  }

  if (selection.includeUntracked) {
    for (const entry of snapshot.untracked) {
      if (!map.has(entry.path)) {
        map.set(entry.path, { entry, mode: 'untracked' });
      }
    }
  }

  return [...map.values()].sort((a, b) => (a.entry.path < b.entry.path ? -1 : a.entry.path > b.entry.path ? 1 : 0));
}
