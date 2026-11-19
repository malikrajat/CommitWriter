import { describe, expect, it } from 'vitest';
import {
  hasSelection,
  selectionLabel,
  type ContextSelection,
} from '../../../src/core/domain/context-selection.js';

function selection(overrides: Partial<ContextSelection> = {}): ContextSelection {
  return { includeStaged: false, includeUnstaged: false, includeUntracked: false, ...overrides };
}

describe('context selection', () => {
  it('detects an empty selection', () => {
    expect(hasSelection(selection())).toBe(false);
    expect(hasSelection(selection({ includeUntracked: true }))).toBe(true);
  });

  it('labels staged-only, unstaged-only and mixed selections', () => {
    expect(selectionLabel(selection({ includeStaged: true }))).toBe('staged');
    expect(selectionLabel(selection({ includeUnstaged: true }))).toBe('unstaged');
    expect(selectionLabel(selection({ includeStaged: true, includeUnstaged: true }))).toBe('all');
    expect(selectionLabel(selection({ includeStaged: true, includeUntracked: true }))).toBe('all');
    expect(selectionLabel(selection({ includeUntracked: true }))).toBe('unstaged');
  });
});
