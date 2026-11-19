import type { AppError } from '../domain/errors.js';
import type { CancelSignal } from '../domain/cancel-signal.js';
import type { Result } from '../domain/result.js';
import type { PromptSegment } from '../domain/budget.js';
import type { FileCategory } from '../context/file-classifier.js';
import type { SummaryCache } from './summary-cache.js';

export interface SummaryChunk {
  readonly index: number;
  readonly groupKey: string;
  readonly segments: readonly PromptSegment[];
  readonly files: readonly string[];
  readonly tokens: number;
  readonly categories: readonly FileCategory[];
}

export interface ChunkPlan {
  readonly chunks: readonly SummaryChunk[];
  readonly totalTokens: number;
  readonly tokenLimit: number;
}

export interface SummaryChunkReport {
  readonly index: number;
  readonly groupKey: string;
  readonly files: readonly string[];
  readonly tokens: number;
  readonly text?: string;
  readonly cached: boolean;
  readonly attempts: number;
  readonly error?: { readonly code: string; readonly message: string };
}

export interface GroupSummary {
  readonly key: string;
  readonly files: readonly string[];
  readonly text: string;
  readonly analyzed: boolean;
  readonly notAnalyzed: readonly string[];
}

export interface SummaryCoverage {
  readonly files: number;
  readonly analyzed: number;
  readonly failed: number;
  readonly omitted: number;
  readonly truncatedFiles: number;
}

export interface ChangeSummary {
  readonly chunks: readonly SummaryChunkReport[];
  readonly groups: readonly GroupSummary[];
  readonly texts: readonly string[];
  readonly consolidated: string;
  readonly coverage: SummaryCoverage;
  readonly limitations: readonly string[];
}

export type SummaryProgressPhase = 'summarizing' | 'aggregating';

export interface SummaryProgress {
  readonly phase: SummaryProgressPhase;
  readonly completed: number;
  readonly total: number;
  readonly label: string;
}

export interface SummaryModelRequest {
  readonly system: string;
  readonly user: string;
  readonly maxTokens: number;
}

export interface SummaryModel {
  /** Cache namespace, usually provider id + model id. */
  readonly cacheKey: string;
  summarize(request: SummaryModelRequest, signal: CancelSignal): Promise<Result<string, AppError>>;
}

export interface SummaryOptions {
  readonly system: string;
  readonly maxTokens: number;
  readonly chunkTokens: number;
  readonly maxAttempts: number;
  readonly cache?: SummaryCache;
  readonly onProgress?: (event: SummaryProgress) => void;
}
