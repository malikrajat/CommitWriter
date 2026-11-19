import { describe, expect, it } from 'vitest';
import { buildChangeBrief } from '../../../src/core/message/change-brief.js';
import { validateGrounding } from '../../../src/core/message/grounding-validator.js';
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

const sourceFiles = [file('src/git/a.ts', { insertions: 10 }), file('src/git/b.ts', { insertions: 5 })];
const sourceBrief = buildChangeBrief(sourceFiles);

describe('validateGrounding', () => {
  it('accepts a message anchored to the change', () => {
    const warnings = validateGrounding({
      subject: 'feat(git): add staged diff collection',
      conventional: { type: 'feat', scope: 'git', breaking: false, description: 'add staged diff collection' },
      brief: sourceBrief,
    });
    expect(warnings).toEqual([]);
  });

  it('flags files that are not part of the change', () => {
    const warnings = validateGrounding({
      subject: 'fix: update src/missing/path.ts',
      conventional: { type: 'fix', scope: undefined, breaking: false, description: 'update src/missing/path.ts' },
      brief: sourceBrief,
    });
    expect(warnings.join(' ')).toContain('src/missing/path.ts');
  });

  it('does not flag paths that exist in the change', () => {
    const warnings = validateGrounding({
      subject: 'fix(src): update src/git/a.ts',
      conventional: { type: 'fix', scope: 'src', breaking: false, description: 'update src/git/a.ts' },
      brief: sourceBrief,
    });
    expect(warnings).toEqual([]);
  });

  it('accepts a changed directory mentioned without a file name', () => {
    const warnings = validateGrounding({
      subject: 'refactor: reorganize src/git',
      conventional: { type: 'refactor', scope: undefined, breaking: false, description: 'reorganize src/git' },
      brief: sourceBrief,
    });
    expect(warnings).toEqual([]);
  });

  it('flags a docs type when no documentation changed', () => {
    const warnings = validateGrounding({
      subject: 'docs: describe the collector',
      conventional: { type: 'docs', scope: undefined, breaking: false, description: 'describe the collector' },
      brief: sourceBrief,
    });
    expect(warnings.join(' ')).toContain('no documentation files');
  });

  it('flags a test type when no tests changed', () => {
    const warnings = validateGrounding({
      subject: 'test: cover the collector',
      conventional: { type: 'test', scope: undefined, breaking: false, description: 'cover the collector' },
      brief: sourceBrief,
    });
    expect(warnings.join(' ')).toContain('no test files');
  });

  it('flags additions described for a deletion-only change', () => {
    const deletionBrief = buildChangeBrief([file('src/old.ts', { status: 'deleted', insertions: 0, deletions: 40 })]);
    const warnings = validateGrounding({
      subject: 'feat: add a new parser',
      conventional: { type: 'feat', scope: undefined, breaking: false, description: 'add a new parser' },
      brief: deletionBrief,
    });
    expect(warnings.some((warning) => warning.includes('only deletes code'))).toBe(true);
  });

  it('flags removals described when nothing was deleted', () => {
    const warnings = validateGrounding({
      subject: 'fix: remove the legacy branch',
      conventional: { type: 'fix', scope: undefined, breaking: false, description: 'remove the legacy branch' },
      brief: sourceBrief,
    });
    expect(warnings.some((warning) => warning.includes('nothing was deleted'))).toBe(true);
  });

  it('scans the body as well as the subject', () => {
    const warnings = validateGrounding({
      subject: 'feat: improve collection',
      conventional: { type: 'feat', scope: undefined, breaking: false, description: 'improve collection' },
      body: 'Touches libs/unknown/file.ts as well.',
      brief: sourceBrief,
    });
    expect(warnings.join(' ')).toContain('libs/unknown/file.ts');
  });
});
