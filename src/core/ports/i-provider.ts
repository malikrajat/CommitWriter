import type { CancelSignal } from '../domain/cancel-signal.js';
import type { AppError } from '../domain/errors.js';
import type { ProviderId, ProviderProfile } from '../domain/provider-profile.js';
import type { Result } from '../domain/result.js';

export interface ModelInfo {
  readonly id: string;
  readonly label: string;
  readonly contextWindow?: number;
}

export interface GenerateRequest {
  readonly model: string;
  readonly system: string;
  readonly user: string;
  readonly maxOutputTokens: number;
  readonly temperature: number;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly signal: CancelSignal;
}

export type FinishReason = 'stop' | 'length' | 'filtered';

export interface TokenUsage {
  readonly input: number;
  readonly output: number;
}

export interface GenerateResult {
  readonly text: string;
  readonly usage?: TokenUsage;
  readonly finishReason: FinishReason;
  readonly requestId?: string;
}

export interface AIProvider {
  readonly id: ProviderId;
  readonly supportsModelListing: boolean;
  listModels(profile: ProviderProfile, signal: CancelSignal): Promise<Result<ModelInfo[], AppError>>;
  generate(profile: ProviderProfile, request: GenerateRequest): Promise<Result<GenerateResult, AppError>>;
}
