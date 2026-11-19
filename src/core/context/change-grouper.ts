import type { FileChange } from '../domain/file-change.js';
import { classifyFile, type FileCategory } from './file-classifier.js';

export interface ChangeGroup {
  readonly key: string;
  readonly label: string;
  readonly files: readonly FileChange[];
  readonly categories: Readonly<Partial<Record<FileCategory, number>>>;
  readonly insertions: number;
  readonly deletions: number;
}

const WORKSPACE_ROOTS = new Set(['packages', 'apps', 'libs', 'modules', 'services', 'crates', 'plugins']);

/**
 * Deterministic grouping: monorepo package first, otherwise the top-level
 * directory. Root-level files share a `(root)` group.
 */
export function groupKeyFor(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  if (parts.length === 1) {
    return '(root)';
  }
  const first = parts[0] ?? '(root)';
  if (WORKSPACE_ROOTS.has(first) && parts.length > 2) {
    return `${first}/${parts[1]}`;
  }
  return first;
}

export function groupChanges(files: readonly FileChange[]): readonly ChangeGroup[] {
  const buckets = new Map<string, FileChange[]>();
  for (const file of files) {
    const key = groupKeyFor(file.path);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(file);
    } else {
      buckets.set(key, [file]);
    }
  }

  return [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([key, groupFiles]) => {
      const categories: Partial<Record<FileCategory, number>> = {};
      let insertions = 0;
      let deletions = 0;
      for (const file of groupFiles) {
        const classification = classifyFile(file);
        categories[classification.category] = (categories[classification.category] ?? 0) + 1;
        insertions += file.insertions;
        deletions += file.deletions;
      }
      return { key, label: key, files: groupFiles, categories, insertions, deletions };
    });
}
