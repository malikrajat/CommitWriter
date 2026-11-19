import { describe, expect, it } from 'vitest';
import { selectEntries } from '../../../src/git/change-selection.js';
import type { CollectorOptions, GitChangeEntry, GitStatusSnapshot } from '../../../src/core/ports/i-git.js';
import type { ContextSelection } from '../../../src/core/domain/context-selection.js';

function entry(path: string, staged: boolean, status: GitChangeEntry['status'] = 'modified'): GitChangeEntry {
  return { path, status, staged };
}

function snapshot(overrides: Partial<GitStatusSnapshot> = {}): GitStatusSnapshot {
  return {
    staged: [],
    unstaged: [],
    untracked: [],
    conflicted: [],
    ...overrides,
  };
}

function options(selection: Partial<ContextSelection> = {}): CollectorOptions {
  return {
    selection: {
      includeStaged: true,
      includeUnstaged: false,
      includeUntracked: false,
      ...selection,
    },
    maxFiles: 100,
    maxFileBytes: 100000,
    excludeGlobs: [],
    allowSensitive: false,
  };
}

const full = snapshot({
  staged: [entry('src/a.ts', true), entry('src/renamed.ts', true, 'renamed')],
  unstaged: [entry('src/a.ts', false), entry('src/b.ts', false)],
  untracked: [entry('src/new.ts', false, 'untracked')],
  conflicted: [entry('src/conflict.ts', false, 'conflicted')],
});

describe('selectEntries', () => {
  it('returns staged changes only by default', () => {
    const selected = selectEntries(full, options());
    expect(selected.map((item) => item.entry.path)).toEqual(['src/a.ts', 'src/renamed.ts']);
    expect(selected.every((item) => item.mode === 'staged')).toBe(true);
  });

  it('can include only unstaged changes', () => {
    const selected = selectEntries(full, options({ includeStaged: false, includeUnstaged: true }));
    expect(selected.map((item) => item.entry.path)).toEqual(['src/a.ts', 'src/b.ts', 'src/conflict.ts']);
    expect(selected.every((item) => item.mode === 'working')).toBe(true);
  });

  it('can include only untracked files', () => {
    const selected = selectEntries(full, options({ includeStaged: false, includeUntracked: true }));
    expect(selected.map((item) => item.entry.path)).toEqual(['src/new.ts']);
    expect(selected[0].mode).toBe('untracked');
  });

  it('combines staged and untracked without unstaged', () => {
    const selected = selectEntries(full, options({ includeUntracked: true }));
    expect(selected.map((item) => item.entry.path)).toEqual([
      'src/a.ts',
      'src/new.ts',
      'src/renamed.ts',
    ]);
  });

  it('lets working-tree entries win when staged and unstaged are both enabled', () => {
    const selected = selectEntries(full, options({ includeUnstaged: true, includeUntracked: true }));
    expect(selected.find((item) => item.entry.path === 'src/a.ts')?.mode).toBe('working');
    expect(selected.find((item) => item.entry.path === 'src/renamed.ts')?.mode).toBe('staged');
    expect(selected.find((item) => item.entry.path === 'src/conflict.ts')?.mode).toBe('working');
  });

  it('never includes untracked files unless enabled', () => {
    const selected = selectEntries(full, options({ includeUnstaged: true }));
    expect(selected.map((item) => item.entry.path)).not.toContain('src/new.ts');
  });

  it('is deterministic and sorted by path', () => {
    const reversed = snapshot({ staged: [entry('z.ts', true), entry('a.ts', true)] });
    expect(selectEntries(reversed, options()).map((item) => item.entry.path)).toEqual(['a.ts', 'z.ts']);
    expect(selectEntries(reversed, options())).toEqual(selectEntries(reversed, options()));
  });

  it('returns an empty selection for an unchanged repository', () => {
    expect(
      selectEntries(snapshot(), options({ includeStaged: true, includeUnstaged: true, includeUntracked: true })),
    ).toEqual([]);
  });
});
