import type { ChangeStatus } from './diff-hunk.js';
import type { OmittedFile } from './file-change.js';

export interface PromptSegment {
  readonly path: string;
  readonly status: ChangeStatus;
  readonly staged: boolean;
  readonly insertions: number;
  readonly deletions: number;
  readonly lines: readonly string[];
  readonly omittedLines: number;
}

export type PlanStrategy = 'single-pass' | 'map-reduce';

export interface DiffPlan {
  readonly strategy: PlanStrategy;
  readonly segments: readonly PromptSegment[];
  readonly omitted: readonly OmittedFile[];
  readonly manifest: readonly string[];
  readonly estimatedTokens: number;
  readonly manifestTokens: number;
  readonly budgetTokens: number;
  readonly chunkCount: number;
}

export interface Budget {
  readonly maxDiffTokens: number;
  readonly maxFiles: number;
  readonly maxFileDiffLines: number;
  readonly allowMapReduce: boolean;
  /** Detailed mode: always analyze in chunks when more than one file changed. */
  readonly forceMapReduce?: boolean;
}
