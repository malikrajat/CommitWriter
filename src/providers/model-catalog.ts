import type { CancelSignal } from '../core/domain/cancel-signal.js';
import type { AppError } from '../core/domain/errors.js';
import type { ProviderProfile } from '../core/domain/provider-profile.js';
import type { Result } from '../core/domain/result.js';
import type { AIProvider, ModelInfo } from '../core/ports/i-provider.js';

interface CacheEntry {
  readonly models: readonly ModelInfo[];
  readonly at: number;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export class ModelCatalog {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly ttlMs: number = DEFAULT_TTL_MS) {}

  async list(
    profile: ProviderProfile,
    provider: AIProvider,
    signal: CancelSignal,
    now: number,
  ): Promise<Result<readonly ModelInfo[], AppError>> {
    const key = `${profile.provider}|${profile.id}|${profile.baseUrl}`;
    const cached = this.cache.get(key);
    if (cached && now - cached.at < this.ttlMs) {
      return { ok: true, value: cached.models };
    }

    const result = await provider.listModels(profile, signal);
    if (result.ok) {
      this.cache.set(key, { models: result.value, at: now });
    }
    return result;
  }

  invalidate(profileId?: string): void {
    if (!profileId) {
      this.cache.clear();
      return;
    }
    for (const key of [...this.cache.keys()]) {
      if (key.includes(`|${profileId}|`)) {
        this.cache.delete(key);
      }
    }
  }
}
