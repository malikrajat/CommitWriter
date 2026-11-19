import type { Disposable } from '../domain/cancel-signal.js';
import type { ContextSelection } from '../domain/context-selection.js';
import type { AppError } from '../domain/errors.js';
import type { GenerationMode, ModeOverride } from '../domain/generation-mode.js';
import type { ProviderProfile } from '../domain/provider-profile.js';
import type { Result } from '../domain/result.js';

export interface ConventionalSettings {
  readonly enabled: boolean;
  readonly types: readonly string[];
  readonly maxSubjectLength: number;
  readonly requireScope: boolean;
  readonly allowedScopes: readonly string[];
}

export interface OutputSettings {
  readonly language: string;
  readonly includeBody: boolean;
  readonly includeIssueKeyFromBranch: boolean;
  readonly attribution: 'none' | 'trailer';
  readonly overwriteDraft: 'ask' | 'replace' | 'append';
}

export interface ContextSettings extends ContextSelection {
  readonly maxDiffTokens: number;
  readonly maxFiles: number;
  readonly maxFileBytes: number;
  readonly maxFileDiffLines: number;
  readonly excludeGlobs: readonly string[];
}

export interface StyleSettings {
  readonly learnFromHistory: boolean;
  readonly historySamples: number;
}

export interface ProviderSettings {
  readonly timeoutMs: number;
  readonly maxRetries: number;
}

export interface PrivacySettings {
  /** Reject non-loopback endpoints; useful for offline/air-gapped use. */
  readonly localOnly: boolean;
}

/** Immutable snapshot of user configuration for one invocation. */
export interface ResolvedConfig {
  readonly mode: GenerationMode;
  readonly modeOverrides: Partial<Record<GenerationMode, ModeOverride>>;
  readonly context: ContextSettings;
  readonly style: StyleSettings;
  readonly conventional: ConventionalSettings;
  readonly output: OutputSettings;
  readonly provider: ProviderSettings;
  readonly privacy: PrivacySettings;
  readonly statusBarEnabled: boolean;
  readonly logLevel: 'off' | 'error' | 'warn' | 'info' | 'debug';
}

export interface IConfig {
  read(): ResolvedConfig;
  onDidChange(listener: () => void): Disposable;
}

export interface IProfileService {
  activeProfile(): Promise<Result<ProviderProfile, AppError>>;
  list(): Promise<readonly ProviderProfile[]>;
  select(profileId: string): Promise<Result<ProviderProfile, AppError>>;
  updateModel(profileId: string, model: string): Promise<Result<ProviderProfile, AppError>>;
}
