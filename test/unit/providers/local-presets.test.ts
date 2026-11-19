import { describe, expect, it } from 'vitest';
import { neverCancelled } from '../../../src/core/domain/cancel-signal.js';
import type { ProviderId, ProviderProfile } from '../../../src/core/domain/provider-profile.js';
import { ok } from '../../../src/core/domain/result.js';
import type { HttpRequest, IHttpClient } from '../../../src/core/ports/i-http-client.js';
import type { ISecretStore } from '../../../src/core/ports/i-secret-store.js';
import { AuthResolver } from '../../../src/providers/auth-resolver.js';
import { PROVIDER_PRESETS } from '../../../src/providers/presets.js';
import { resolveEffectiveProfile } from '../../../src/providers/profile-resolver.js';
import { ProviderRegistry } from '../../../src/providers/registry.js';

const LOCAL_PROVIDERS: readonly ProviderId[] = ['ollama', 'lmstudio', 'llamacpp', 'vllm'];

class MockHttp implements IHttpClient {
  readonly requests: HttpRequest[] = [];

  async send(request: HttpRequest) {
    this.requests.push(request);
    return ok({
      status: 200,
      headers: {},
      text: JSON.stringify({ choices: [{ message: { content: 'feat: local' }, finish_reason: 'stop' }] }),
    });
  }
}

const secrets: ISecretStore = {
  put: async (profileId, kind) => ok({ profileId, kind, present: true }),
  describe: async (profileId, kind) => ({ profileId, kind, present: true }),
  delete: async () => undefined,
  reveal: async () => undefined,
};

function profileFor(provider: ProviderId): ProviderProfile {
  const preset = PROVIDER_PRESETS[provider];
  const resolved = resolveEffectiveProfile({
    id: provider,
    label: preset.label,
    provider,
    dialect: preset.dialect,
    baseUrl: preset.baseUrl,
    model: preset.modelHint,
    contextWindow: preset.defaultContextWindow,
    temperature: 0.2,
    maxOutputTokens: 256,
  });
  if (!resolved.ok) {
    throw new Error(resolved.error.message);
  }
  return resolved.value;
}

describe('local AI presets', () => {
  it.each(LOCAL_PROVIDERS)('%s uses a loopback endpoint without authentication', (provider) => {
    const preset = PROVIDER_PRESETS[provider];
    expect(preset.baseUrl).toMatch(/^http:\/\/(127\.0\.0\.1|localhost)/);
    expect(preset.auth).toBe('none');
  });

  it('accepts local endpoints in local-only mode', () => {
    for (const provider of LOCAL_PROVIDERS) {
      const resolved = resolveEffectiveProfile(profileFor(provider), { localOnly: true });
      expect(resolved.ok, provider).toBe(true);
    }
  });

  it('rejects cloud endpoints in local-only mode', () => {
    const cloud = profileFor('openai');
    const resolved = resolveEffectiveProfile(cloud, { localOnly: true });
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      expect(resolved.error.code).toBe('url_rejected');
      expect(resolved.error.message).toContain('local-only');
    }
  });

  it('sends no auth header to LM Studio and targets its chat endpoint', async () => {
    const http = new MockHttp();
    const profile = profileFor('lmstudio');
    const result = await new ProviderRegistry(http, new AuthResolver(secrets))
      .get(profile)
      .generate(profile, {
        model: profile.model,
        system: 'system',
        user: 'user',
        maxOutputTokens: 256,
        temperature: 0.2,
        timeoutMs: 1000,
        maxRetries: 0,
        signal: neverCancelled,
      });

    expect(result.ok).toBe(true);
    expect(http.requests[0].url).toBe('http://127.0.0.1:1234/v1/chat/completions');
    expect(http.requests[0].headers['authorization']).toBeUndefined();
  });
});
