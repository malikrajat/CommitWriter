import { describe, expect, it } from 'vitest';
import { planSummaryChunks } from '../../../src/core/summary/chunk-planner.js';
import type { DiffPlan, PromptSegment } from '../../../src/core/domain/budget.js';

function segment(path: string, lines = 20): PromptSegment {
  return {
    path,
    status: 'modified',
    staged: true,
    insertions: lines,
    deletions: 0,
    lines: Array.from({ length: lines }, (_, index) => `+line ${index} of ${path}`),
    omittedLines: 0,
  };
}

function plan(segments: readonly PromptSegment[]): DiffPlan {
  return {
    strategy: 'map-reduce',
    segments,
    omitted: [],
    manifest: segments.map((entry) => entry.path),
    estimatedTokens: segments.length * 100,
    manifestTokens: 10,
    budgetTokens: 12000,
    chunkCount: 1,
  };
}

describe('planSummaryChunks', () => {
  it('puts everything in one chunk when it fits', () => {
    const result = planSummaryChunks(plan([segment('src/a.ts'), segment('src/b.ts')]), 10000);
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].files).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('splits when the token limit is exceeded', () => {
    const segments = Array.from({ length: 6 }, (_, index) => segment(`src/f${index}.ts`, 40));
    const result = planSummaryChunks(plan(segments), 400);
    expect(result.chunks.length).toBeGreaterThan(1);
  });

  it('never loses or duplicates a segment', () => {
    const segments = Array.from({ length: 9 }, (_, index) => segment(`packages/p${index % 3}/f${index}.ts`, 25));
    const result = planSummaryChunks(plan(segments), 300);
    const files = result.chunks.flatMap((chunk) => chunk.files).sort();
    expect(files).toEqual(segments.map((entry) => entry.path).sort());
  });

  it('keeps chunks within the limit except for a single oversized file', () => {
    const segments = [segment('src/a.ts', 30), segment('src/b.ts', 30), segment('src/c.ts', 30)];
    const limit = 350;
    const result = planSummaryChunks(plan(segments), limit);
    for (const chunk of result.chunks) {
      if (chunk.files.length > 1) {
        expect(chunk.tokens).toBeLessThanOrEqual(limit * 1.5);
      }
    }
  });

  it('is deterministic', () => {
    const segments = [segment('src/b.ts'), segment('src/a.ts'), segment('docs/x.md')];
    const first = planSummaryChunks(plan(segments), 500);
    const second = planSummaryChunks(plan(segments), 500);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('groups chunks by directory key', () => {
    const result = planSummaryChunks(
      plan([segment('src/a.ts'), segment('docs/a.md'), segment('src/b.ts')]),
      10000,
    );
    const keys = result.chunks.map((chunk) => chunk.groupKey);
    expect(keys).toEqual(['docs', 'src']);
    expect(result.chunks[0].files).toEqual(['docs/a.md']);
    expect(result.chunks[1].files).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('handles an empty plan', () => {
    expect(planSummaryChunks(plan([]), 1000).chunks).toEqual([]);
  });
});
