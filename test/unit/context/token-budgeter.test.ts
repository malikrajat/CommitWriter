import { describe, expect, it } from 'vitest';
import { buildPlan } from '../../../src/core/context/token-budgeter.js';
import type { Budget } from '../../../src/core/domain/budget.js';
import type { ChangeStatus } from '../../../src/core/domain/diff-hunk.js';
import type { FileChange } from '../../../src/core/domain/file-change.js';

function file(path: string, lineCount: number, status: ChangeStatus = 'modified'): FileChange {
  const lines = Array.from({ length: lineCount }, (_, index) => `+line ${index} of ${path}`);
  return {
    path,
    status,
    staged: true,
    insertions: lineCount,
    deletions: 0,
    isBinary: false,
    hunks: [
      {
        header: `@@ -0,0 +1,${lineCount} @@`,
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: lineCount,
        lines,
      },
    ],
    omittedLines: 0,
    sensitivity: 'none',
  };
}

function budget(overrides: Partial<Budget> = {}): Budget {
  return { maxDiffTokens: 12000, maxFiles: 200, maxFileDiffLines: 400, allowMapReduce: true, ...overrides };
}
describe('buildPlan', () => {
  it('includes every file when the budget allows', () => {
    const files = [file('src/a.ts', 5), file('src/b.ts', 5)];
    const plan = buildPlan({ files, omitted: [], budget: budget(), overheadTokens: 200 });
    expect(plan.segments).toHaveLength(2);
    expect(plan.omitted).toHaveLength(0);
    expect(plan.strategy).toBe('single-pass');
  });

  it('never exceeds the token budget and reports omissions', () => {
    const files = Array.from({ length: 20 }, (_, index) => file(`src/mod${index}/file.ts`, 200));
    const plan = buildPlan({
      files,
      omitted: [],
      budget: budget({ maxDiffTokens: 1000 }),
      overheadTokens: 200,
    });
    expect(plan.estimatedTokens).toBeLessThanOrEqual(1000);
    expect(plan.omitted.length).toBeGreaterThan(0);
    expect(plan.strategy).toBe('map-reduce');
    expect(plan.segments.length + plan.omitted.length).toBe(files.length);
  });

  it('always sends the manifest, even when every diff is dropped', () => {
    const files = Array.from({ length: 30 }, (_, index) => file(`src/f${index}.ts`, 300));
    const plan = buildPlan({
      files,
      omitted: [],
      budget: budget({ maxDiffTokens: 500 }),
      overheadTokens: 4000,
    });
    expect(plan.segments).toHaveLength(0);
    for (const entry of files) {
      expect(plan.manifest.join('\n')).toContain(entry.path);
    }
    expect(plan.estimatedTokens).toBeGreaterThan(500); // manifest overflow is explicit, not silent
  });

  it('truncates oversized diffs explicitly', () => {
    const files = [file('src/huge.ts', 5000)];
    const plan = buildPlan({
      files,
      omitted: [],
      budget: budget({ maxDiffTokens: 2000, maxFileDiffLines: 5000 }),
      overheadTokens: 100,
    });
    expect(plan.segments).toHaveLength(1);
    expect(plan.segments[0].omittedLines).toBeGreaterThan(0);
    expect(plan.segments[0].lines.join('\n')).toContain('lines omitted');
  });

  it('reports files beyond maxFiles', () => {
    const files = Array.from({ length: 10 }, (_, index) => file(`src/f${index}.ts`, 3));
    const plan = buildPlan({
      files,
      omitted: [],
      budget: budget({ maxFiles: 4 }),
      overheadTokens: 100,
    });
    expect(plan.segments.length).toBeLessThanOrEqual(4);
    expect(plan.omitted.filter((entry) => entry.reason === 'max-files')).toHaveLength(6);
  });

  it('is deterministic', () => {
    const files = Array.from({ length: 12 }, (_, index) => file(`src/f${index}.ts`, 40));
    const input = { files, omitted: [], budget: budget({ maxDiffTokens: 3000 }), overheadTokens: 150 };
    expect(JSON.stringify(buildPlan(input))).toBe(JSON.stringify(buildPlan(input)));
  });

  it('keeps the manifest in path order regardless of ranking', () => {
    const files = [file('src/z.ts', 5, 'added'), file('src/a.ts', 5, 'modified')];
    const plan = buildPlan({ files, omitted: [], budget: budget(), overheadTokens: 10 });
    expect(plan.manifest[0]).toContain('src/a.ts');
    expect(plan.manifest[1]).toContain('src/z.ts');
  });

  it('forces map-reduce in detailed mode for more than one file', () => {
    const files = [file('src/a.ts', 5), file('src/b.ts', 5)];
    const plan = buildPlan({
      files,
      omitted: [],
      budget: budget({ forceMapReduce: true }),
      overheadTokens: 100,
    });
    expect(plan.strategy).toBe('map-reduce');
  });

  it('stays single-pass in adaptive mode for a small change set', () => {
    const files = [file('src/a.ts', 5), file('src/b.ts', 5)];
    const plan = buildPlan({ files, omitted: [], budget: budget(), overheadTokens: 100 });
    expect(plan.strategy).toBe('single-pass');
  });

  it('keeps quick mode single-pass even when the budget drops files', () => {
    const files = Array.from({ length: 30 }, (_, index) => file(`src/f${index}.ts`, 40));
    const plan = buildPlan({
      files,
      omitted: [],
      budget: budget({ allowMapReduce: false, maxDiffTokens: 800 }),
      overheadTokens: 200,
    });
    expect(plan.strategy).toBe('single-pass');
  });
});
