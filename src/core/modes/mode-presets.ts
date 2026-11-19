import type { GenerationMode, ModeOverride, ModePreset } from '../domain/generation-mode.js';

/**
 * Built-in ceilings. Overrides may only lower these numbers.
 */
export const MODE_PRESETS: Readonly<Record<GenerationMode, ModePreset>> = {
  quick: {
    id: 'quick',
    depth: 'single-pass',
    maxDiffTokens: 2500,
    maxFiles: 40,
    maxFileDiffLines: 120,
    maxOutputTokens: 96,
    includeBody: false,
    includeFooters: false,
    useMapReduce: false,
    useStyleHistory: false,
    historySamples: 0,
    temperature: 0.1,
    timeoutMs: 20000,
    maxRetries: 1,
  },
  smart: {
    id: 'smart',
    depth: 'adaptive',
    maxDiffTokens: 12000,
    maxFiles: 200,
    maxFileDiffLines: 400,
    maxOutputTokens: 512,
    includeBody: true,
    includeFooters: true,
    useMapReduce: true,
    useStyleHistory: true,
    historySamples: 30,
    temperature: 0.2,
    timeoutMs: 60000,
    maxRetries: 2,
  },
  detailed: {
    id: 'detailed',
    depth: 'deep',
    maxDiffTokens: 48000,
    maxFiles: 600,
    maxFileDiffLines: 1200,
    maxOutputTokens: 1536,
    includeBody: true,
    includeFooters: true,
    useMapReduce: true,
    useStyleHistory: true,
    historySamples: 50,
    temperature: 0.3,
    timeoutMs: 120000,
    maxRetries: 2,
  },
};

export interface ModeCeilings {
  /** Global token ceiling, applied as an upper bound. */
  readonly maxDiffTokens: number;
  /** Model context window; map-reduce budgets must stay below half of it. */
  readonly contextWindow: number;
}

function lowerOf(base: number, candidate: number | undefined): number {
  return candidate === undefined ? base : Math.min(base, candidate);
}

export function resolveMode(
  mode: GenerationMode,
  override: ModeOverride | undefined,
  ceilings: ModeCeilings,
): ModePreset {  const preset = MODE_PRESETS[mode];
  const contextCeiling = Math.max(500, Math.floor(ceilings.contextWindow / 2));
  const maxDiffTokens = Math.min(
    lowerOf(preset.maxDiffTokens, override?.maxDiffTokens),
    ceilings.maxDiffTokens,
    contextCeiling,
  );

  return {
    ...preset,
    maxDiffTokens,
    maxFiles: lowerOf(preset.maxFiles, override?.maxFiles),
    maxOutputTokens: lowerOf(preset.maxOutputTokens, override?.maxOutputTokens),
    includeBody: override?.includeBody === false ? false : preset.includeBody,
    useMapReduce: override?.useMapReduce === false ? false : preset.useMapReduce,
    timeoutMs: lowerOf(preset.timeoutMs, override?.timeoutMs),
  };
}

/**
 * Effective timeout = the smallest of the mode budget, the global ceiling and
 * an optional per-profile override.
 */
export function resolveRequestTimeout(
  modeTimeoutMs: number,
  globalCeilingMs: number,
  profileTimeoutMs?: number,
): number {
  const ceiling = Math.min(modeTimeoutMs, globalCeilingMs);
  return profileTimeoutMs === undefined ? ceiling : Math.min(ceiling, profileTimeoutMs);
}
