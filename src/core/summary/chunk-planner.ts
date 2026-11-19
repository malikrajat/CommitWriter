import type { DiffPlan, PromptSegment } from '../domain/budget.js';
import { groupKeyFor } from '../context/change-grouper.js';
import { classifyPath, type FileCategory } from '../context/file-classifier.js';
import { estimateLines } from '../context/token-estimator.js';
import type { ChunkPlan, SummaryChunk } from './summary-types.js';

function categoriesOf(segments: readonly PromptSegment[]): readonly FileCategory[] {
  const set = new Set<FileCategory>();
  for (const segment of segments) {
    set.add(classifyPath(segment.path).category);
  }
  return [...set];
}

/**
 * Deterministic chunking that keeps directory groups together where possible
 * and never exceeds the per-chunk token limit unless a single file is larger
 * (the budgeter has already trimmed it).
 */
export function planSummaryChunks(plan: DiffPlan, chunkTokens: number): ChunkPlan {
  const limit = Math.max(500, Math.floor(chunkTokens));
  const ordered = [...plan.segments].sort((a, b) => {
    const groupA = groupKeyFor(a.path);
    const groupB = groupKeyFor(b.path);
    if (groupA !== groupB) {
      return groupA < groupB ? -1 : 1;
    }
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });

  const chunks: SummaryChunk[] = [];
  let current: PromptSegment[] = [];
  let currentTokens = 0;

  const flush = (): void => {
    if (current.length === 0) {
      return;
    }
    chunks.push({
      index: chunks.length,
      groupKey: groupKeyFor(current[0]?.path ?? ''),
      segments: current,
      files: current.map((segment) => segment.path),
      tokens: currentTokens,
      categories: categoriesOf(current),
    });
    current = [];
    currentTokens = 0;
  };

  for (const segment of ordered) {
    const segmentTokens = estimateLines(segment.lines) + 24;
    const currentGroup = current.length > 0 ? groupKeyFor(current[0]?.path ?? '') : undefined;
    const nextGroup = groupKeyFor(segment.path);
    if (
      current.length > 0 &&
      (currentGroup !== nextGroup || currentTokens + segmentTokens > limit)
    ) {
      flush();
    }
    current.push(segment);
    currentTokens += segmentTokens;
  }
  flush();

  return {
    chunks,
    totalTokens: chunks.reduce((total, chunk) => total + chunk.tokens, 0),
    tokenLimit: limit,
  };
}
