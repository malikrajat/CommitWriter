import * as vscode from 'vscode';
import type { Disposable } from '../core/domain/cancel-signal.js';
import type { GenerationMode, ModeOverride } from '../core/domain/generation-mode.js';
import { GENERATION_MODES, isGenerationMode } from '../core/domain/generation-mode.js';
import type { IConfig, ResolvedConfig } from '../core/ports/i-config.js';

import { PRODUCT } from '../core/product.js';

const SECTION = PRODUCT.configSection;

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function readModeOverride(value: unknown): ModeOverride | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const override: ModeOverride = {
    maxDiffTokens: typeof record['maxDiffTokens'] === 'number' ? record['maxDiffTokens'] : undefined,
    maxFiles: typeof record['maxFiles'] === 'number' ? record['maxFiles'] : undefined,
    maxOutputTokens:
      typeof record['maxOutputTokens'] === 'number' ? record['maxOutputTokens'] : undefined,
    includeBody: typeof record['includeBody'] === 'boolean' ? record['includeBody'] : undefined,
    useMapReduce: typeof record['useMapReduce'] === 'boolean' ? record['useMapReduce'] : undefined,
    timeoutMs: typeof record['timeoutMs'] === 'number' ? record['timeoutMs'] : undefined,
  };
  return override;
}

export class ConfigService implements IConfig {
  read(): ResolvedConfig {
    const config = vscode.workspace.getConfiguration(SECTION);

    const modeValue = config.get<string>('mode', 'smart');
    const mode: GenerationMode = isGenerationMode(modeValue) ? modeValue : 'smart';

    const overridesRaw = config.get<Record<string, unknown>>('modes.overrides', {});
    const modeOverrides: Partial<Record<GenerationMode, ModeOverride>> = {};
    for (const candidate of GENERATION_MODES) {
      const entry = readModeOverride(overridesRaw?.[candidate]);
      if (entry) {
        modeOverrides[candidate] = entry;
      }
    }

    const language = config.get<string>('output.language', 'en');
    const attribution = config.get<string>('output.attribution', 'none');
    const overwriteDraft = config.get<string>('output.overwriteDraft', 'ask');
    const logLevel = config.get<string>('log.level', 'warn');

    return {
      mode,
      modeOverrides,
      context: {
        includeStaged: config.get<boolean>('context.includeStaged', true),
        includeUnstaged: config.get<boolean>('context.includeUnstaged', false),
        includeUntracked: config.get<boolean>('context.includeUntracked', false),
        maxDiffTokens: clampInt(config.get('context.maxDiffTokens'), 12000, 500, 200000),
        maxFiles: clampInt(config.get('context.maxFiles'), 200, 1, 2000),
        maxFileBytes: clampInt(config.get('context.maxFileBytes'), 262144, 1024, 2097152),
        maxFileDiffLines: clampInt(config.get('context.maxFileDiffLines'), 400, 20, 5000),
        excludeGlobs: [
          ...(config.get<string[]>('context.excludeGlobs', []) ?? []),
          ...(config.get<string[]>('context.additionalExcludeGlobs', []) ?? []),
        ],
      },
      style: {
        learnFromHistory: config.get<boolean>('style.learnFromHistory', true),
        historySamples: clampInt(config.get('style.historySamples'), 30, 0, 100),
      },
      conventional: {
        enabled: config.get<boolean>('conventional.enabled', true),
        types: config.get<string[]>('conventional.types', []) ?? [],
        maxSubjectLength: clampInt(config.get('conventional.maxSubjectLength'), 72, 20, 120),
        requireScope: config.get<boolean>('conventional.requireScope', false),
        allowedScopes: config.get<string[]>('conventional.allowedScopes', []) ?? [],
      },
      output: {
        language: language === 'auto' ? vscode.env.language : language,
        includeBody: config.get<boolean>('output.includeBody', true),
        includeIssueKeyFromBranch: config.get<boolean>('output.includeIssueKeyFromBranch', false),
        attribution: attribution === 'trailer' ? 'trailer' : 'none',
        overwriteDraft: overwriteDraft === 'replace' || overwriteDraft === 'append' ? overwriteDraft : 'ask',
      },
      provider: {
        timeoutMs: clampInt(config.get('provider.timeoutMs'), 120000, 5000, 300000),
        maxRetries: clampInt(config.get('provider.maxRetries'), 2, 0, 5),
      },
      privacy: {
        localOnly: config.get<boolean>('privacy.localOnly', false),
      },
      statusBarEnabled: config.get<boolean>('statusBar.enabled', true),
      logLevel:
        logLevel === 'off' || logLevel === 'error' || logLevel === 'info' || logLevel === 'debug'
          ? logLevel
          : 'warn',
    };
  }

  onDidChange(listener: () => void): Disposable {
    const subscription = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(SECTION)) {
        listener();
      }
    });
    return { dispose: () => subscription.dispose() };
  }
}
