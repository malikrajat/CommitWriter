import type { Budget, DiffPlan, PlanStrategy, PromptSegment } from '../domain/budget.js';
import type { FileChange, OmittedFile } from '../domain/file-change.js';
import { rankFiles } from './file-ranker.js';
import { toSegment, segmentText, trimLines } from './hunk-trimmer.js';
import { buildManifest } from './manifest-builder.js';
import { estimateLines, estimateTokens } from './token-estimator.js';

export interface PlanInput {
  readonly files: readonly FileChange[];
  readonly omitted: readonly OmittedFile[];
  readonly budget: Budget;
  /** Tokens consumed by the system prompt, instructions and history samples. */
  readonly overheadTokens: number;
  readonly manifestLimit?: number;
}

const WRAPPER_OVERHEAD = 16;
const MIN_USEFUL_LINES = 6;

function byPath(a: FileChange, b: FileChange): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

/**
 * Deterministic context planner. Guarantees:
 *  - the manifest is always present,
 *  - the estimated total never exceeds the mode budget,
 *  - every excluded or truncated file is reported.
 */
export function buildPlan(input: PlanInput): DiffPlan {
  const manifest = buildManifest([...input.files].sort(byPath), input.manifestLimit ?? 500);
  const manifestTokens = estimateTokens(manifest.join('\n'));
  const omitted: OmittedFile[] = [...input.omitted];

  const ranked = rankFiles(input.files);
  const candidates = ranked.slice(0, input.budget.maxFiles);
  for (const file of ranked.slice(input.budget.maxFiles)) {
    omitted.push({ path: file.path, reason: 'max-files' });
  }

  let remaining = input.budget.maxDiffTokens - manifestTokens - input.overheadTokens;
  const segments: PromptSegment[] = [];

  for (const file of candidates) {
    if (remaining <= MIN_USEFUL_LINES * 4) {
      omitted.push({ path: file.path, reason: 'budget' });
      continue;
    }

    const full = toSegment(file, input.budget.maxFileDiffLines);
    const fullCost = estimateLines(full.lines) + WRAPPER_OVERHEAD;

    if (fullCost <= remaining) {
      segments.push(full);
      remaining -= fullCost;
      continue;
    }

    const lineCount = full.lines.length;
    const perLine = lineCount > 0 ? estimateLines(full.lines) / lineCount : 4;
    const allowedLines = Math.floor(Math.max(0, remaining - WRAPPER_OVERHEAD) / perLine);

    if (allowedLines < MIN_USEFUL_LINES) {
      omitted.push({ path: file.path, reason: 'budget' });
      continue;
    }

    const trimmed = trimLines(full.lines, allowedLines);
    const cost = estimateLines(trimmed.lines) + WRAPPER_OVERHEAD;
    if (cost > remaining) {
      omitted.push({ path: file.path, reason: 'budget' });
      continue;
    }

    segments.push({ ...full, lines: trimmed.lines, omittedLines: full.omittedLines + trimmed.omitted });
    remaining -= cost;
  }

  const diffTokens = segments.reduce((total, segment) => total + estimateLines(segment.lines) + WRAPPER_OVERHEAD, 0);
  const estimatedTokens = manifestTokens + input.overheadTokens + diffTokens;
  const truncated = segments.some((segment) => segment.omittedLines > 0);
  const dropped = omitted.some((entry) => entry.reason === 'budget' || entry.reason === 'max-files');

  const reduceNeeded = dropped || truncated;
  const shouldReduce =
    input.budget.allowMapReduce &&
    (input.budget.forceMapReduce === true
      ? input.files.length > 1
      : reduceNeeded && input.files.length > 10);

  const strategy: PlanStrategy = shouldReduce ? 'map-reduce' : 'single-pass';

  const chunkCount =
    strategy === 'map-reduce'
      ? Math.max(2, Math.ceil(diffTokens / Math.max(1200, Math.floor(input.budget.maxDiffTokens / 3))))
      : 1;

  return {
    strategy,
    segments,
    omitted,
    manifest,
    estimatedTokens,
    manifestTokens,
    budgetTokens: input.budget.maxDiffTokens,
    chunkCount,
  };
}

export function planText(plan: DiffPlan): string {
  return plan.segments.map((segment) => `${segment.path}\n${segmentText(segment)}`).join('\n\n');
}
