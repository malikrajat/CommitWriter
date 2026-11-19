export type GenerationMode = 'quick' | 'smart' | 'detailed';

/** How much pre-analysis a mode performs. */
export type GenerationDepth = 'single-pass' | 'adaptive' | 'deep';

export const GENERATION_MODES: readonly GenerationMode[] = ['quick', 'smart', 'detailed'];

export function isGenerationMode(value: unknown): value is GenerationMode {
  return value === 'quick' || value === 'smart' || value === 'detailed';
}

export interface ModeOverride {
  readonly maxDiffTokens?: number;
  readonly maxFiles?: number;
  readonly maxOutputTokens?: number;
  readonly includeBody?: boolean;
  readonly useMapReduce?: boolean;
  readonly timeoutMs?: number;
}

/**
 * Immutable ceiling for a mode. Overrides may only lower numeric values
 * (see `resolveMode`), never raise them.
 */
export interface ModePreset {
  readonly id: GenerationMode;
  readonly depth: GenerationDepth;
  readonly maxDiffTokens: number;
  readonly maxFiles: number;
  readonly maxFileDiffLines: number;
  readonly maxOutputTokens: number;
  readonly includeBody: boolean;
  readonly includeFooters: boolean;
  readonly useMapReduce: boolean;
  readonly useStyleHistory: boolean;
  readonly historySamples: number;
  readonly temperature: number;
  readonly timeoutMs: number;
  readonly maxRetries: number;
}
