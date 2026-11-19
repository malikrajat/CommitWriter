import { describe, expect, it } from 'vitest';
import { buildChangeBrief, formatChangeBrief } from '../../../src/core/message/change-brief.js';
import type { FileChange } from '../../../src/core/domain/file-change.js';

function file(
  path: string,
  options: { status?: FileChange['status']; insertions?: number; deletions?: number } = {},
): FileChange {
  return {
    path,
    status: options.status ?? 'modified',
    staged: true,
    insertions: options.insertions ?? 1,
    deletions: options.deletions ?? 0,
    isBinary: false,
    hunks: [],
    omittedLines: 0,
    sensitivity: 'none',
  };
}

describe('buildChangeBrief', () => {
  const files = [
    file('src/a.ts', { insertions: 5, deletions: 2 }),
    file('src/b.ts', { status: 'added', insertions: 100 }),
    file('src/a.test.ts', { insertions: 10 }),
    file('packages/api/server.ts', { insertions: 200, deletions: 20 }),
    file('docs/guide.md', { insertions: 4 }),
  ];

  it('identifies the primary and secondary areas', () => {
    const brief = buildChangeBrief(files);
    expect(brief.primary?.key).toBe('packages/api');
    expect(brief.secondary.map((group) => group.key)).toContain('src');
    expect(brief.secondary.map((group) => group.key)).toContain('docs');
  });

  it('aggregates counts and categories', () => {
    const brief = buildChangeBrief(files);
    expect(brief.counts.files).toBe(5);
    expect(brief.counts.added).toBe(1);
    expect(brief.counts.tests).toBe(1);
    expect(brief.counts.docs).toBe(1);
    expect(brief.counts.insertions).toBe(319);
    expect(brief.categories['source']).toBeDefined();
  });

  it('derives scope candidates from group keys', () => {
    const brief = buildChangeBrief(files);
    expect(brief.scopeCandidates).toContain('api');
    expect(brief.scopeCandidates).toContain('src');
    expect(brief.scopeCandidates).toContain('docs');
  });

  it('lists every analyzed path for grounding', () => {
    const brief = buildChangeBrief(files);
    expect(brief.paths).toContain('src/a.ts');
    expect(brief.paths).toContain('packages/api/server.ts');
    expect(brief.paths).toHaveLength(5);
  });

  it('formats a prompt overview without unrelated details', () => {
    const text = formatChangeBrief(buildChangeBrief(files));
    expect(text).toContain('Primary area: packages/api');
    expect(text).toContain('Secondary areas:');
    expect(text).toContain('Scope candidates:');
    expect(text).toContain('Only these areas');
    expect(text).not.toContain('some other module');
  });

  it('handles an empty change set', () => {
    const brief = buildChangeBrief([]);
    expect(brief.primary).toBeUndefined();
    expect(brief.counts.files).toBe(0);
    expect(brief.paths).toEqual([]);
  });
});
