import { describe, expect, it } from 'vitest';
import { groupChanges, groupKeyFor } from '../../../src/core/context/change-grouper.js';
import type { FileChange } from '../../../src/core/domain/file-change.js';

function file(path: string, insertions = 1, deletions = 0): FileChange {
  return {
    path,
    status: 'modified',
    staged: true,
    insertions,
    deletions,
    isBinary: false,
    hunks: [],
    omittedLines: 0,
    sensitivity: 'none',
  };
}

describe('groupKeyFor', () => {
  it('groups monorepo packages by package folder', () => {
    expect(groupKeyFor('packages/api/src/a.ts')).toBe('packages/api');
    expect(groupKeyFor('apps/web/src/b.tsx')).toBe('apps/web');
  });

  it('groups other paths by top-level directory', () => {
    expect(groupKeyFor('src/git/a.ts')).toBe('src');
    expect(groupKeyFor('docs/readme.md')).toBe('docs');
  });

  it('puts root-level files in a root group', () => {
    expect(groupKeyFor('README.md')).toBe('(root)');
  });
});

describe('groupChanges', () => {
  it('groups deterministically and aggregates stats', () => {
    const groups = groupChanges([
      file('src/b.ts', 2, 1),
      file('packages/api/a.ts', 5, 0),
      file('src/c.ts', 1, 1),
      file('package.json', 3, 0),
    ]);

    expect(groups.map((group) => group.key)).toEqual(['(root)', 'packages/api', 'src']);
    const src = groups.find((group) => group.key === 'src');
    expect(src?.files).toHaveLength(2);
    expect(src?.insertions).toBe(3);
    expect(src?.deletions).toBe(2);
    expect(src?.categories['source']).toBe(2);
  });

  it('records category counts per group', () => {
    const groups = groupChanges([file('src/a.ts'), file('src/a.test.ts'), file('src/yarn.lock')]);
    const src = groups[0];
    expect(src.categories['source']).toBe(1);
    expect(src.categories['test']).toBe(1);
    expect(src.categories['lockfile']).toBe(1);
  });

  it('returns no groups for no files', () => {
    expect(groupChanges([])).toEqual([]);
  });
});
