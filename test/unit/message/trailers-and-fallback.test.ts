import { describe, expect, it } from 'vitest';
import { heuristicMessage } from '../../../src/core/message/heuristic-fallback.js';
import { applyTrailers, issueKeyFromBranch } from '../../../src/core/message/trailers.js';
import { PRODUCT } from '../../../src/core/product.js';
import type { DiffPlan } from '../../../src/core/domain/budget.js';
import type { CommitMessage } from '../../../src/core/domain/commit-message.js';

const message: CommitMessage = {
  raw: 'feat(git): add collector',
  subject: 'feat(git): add collector',
  footers: [],
  conventional: { type: 'feat', scope: 'git', breaking: false, description: 'add collector' },
  warnings: [],
  provenance: { providerId: 'openai', model: 'm', strategy: 'single-pass', mode: 'smart' },
};

function plan(paths: readonly string[], status: 'added' | 'modified' = 'modified'): DiffPlan {
  return {
    strategy: 'single-pass',
    segments: paths.map((path) => ({
      path,
      status,
      staged: true,
      insertions: 1,
      deletions: 0,
      lines: ['+x'],
      omittedLines: 0,
    })),
    omitted: [],
    manifest: paths,
    estimatedTokens: 100,
    manifestTokens: 10,
    budgetTokens: 1000,
    chunkCount: 1,
  };
}

describe('trailers', () => {
  it('extracts an issue key from a branch name', () => {
    expect(issueKeyFromBranch('feature/PROJ-123-add-thing')).toBe('PROJ-123');
    expect(issueKeyFromBranch('main')).toBeUndefined();
    expect(issueKeyFromBranch(undefined)).toBeUndefined();
  });

  it('adds a Refs footer once', () => {
    const once = applyTrailers(message, { issueKey: 'PROJ-123', attribution: false });
    expect(once.footers).toEqual(['Refs: PROJ-123']);
    expect(once.raw).toContain('Refs: PROJ-123');

    const twice = applyTrailers(once, { issueKey: 'PROJ-123', attribution: false });
    expect(twice.footers).toEqual(['Refs: PROJ-123']);
  });

  it('does not duplicate a key already in the subject', () => {
    const withKey: CommitMessage = { ...message, subject: 'feat(PROJ-1): add collector', raw: 'feat(PROJ-1): add collector' };
    const result = applyTrailers(withKey, { issueKey: 'PROJ-1', attribution: false });
    expect(result.footers).toEqual([]);
  });

  it('adds the attribution trailer when requested', () => {
    const result = applyTrailers(message, { attribution: true });
    expect(result.footers).toContain(`Generated-by: ${PRODUCT.displayName}`);
  });

  it('returns the same message when nothing is added', () => {
    expect(applyTrailers(message, { attribution: false })).toBe(message);
  });
});

describe('heuristicMessage', () => {
  it('derives a deterministic conventional subject', () => {
    const result = heuristicMessage(plan(['src/a.ts', 'src/b.ts']), 'smart');
    expect(result.subject).toBe('chore(src): update 2 files');
    expect(result.provenance.strategy).toBe('heuristic');
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('uses feat when every file is new', () => {
    const result = heuristicMessage(plan(['src/a.ts'], 'added'), 'quick');
    expect(result.subject).toBe('feat(src): add 1 file');
  });
});
