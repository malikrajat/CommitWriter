import { describe, expect, it } from 'vitest';
import { neverCancelled } from '../../../src/core/domain/cancel-signal.js';
import type { ProviderId, ProviderProfile } from '../../../src/core/domain/provider-profile.js';
import { ok } from '../../../src/core/domain/result.js';
import type { HttpRequest, HttpResponse, IHttpClient } from '../../../src/core/ports/i-http-client.js';
import type { GenerateRequest } from '../../../src/core/ports/i-provider.js';
import type { ISecretStore } from '../../../src/core/ports/i-secret-store.js';
import { AuthResolver } from '../../../src/providers/auth-resolver.js';
import { PROVIDER_PRESETS } from '../../../src/providers/presets.js';
import { resolveEffectiveProfile } from '../../../src/providers/profile-resolver.js';
import { ProviderRegistry } from '../../../src/providers/registry.js';

class MockHttp implements IHttpClient {
  readonly requests: HttpRequest[] = [];

  constructor(
    private readonly responder: (request: HttpRequest, index: number) => HttpResponse | Promise<HttpResponse>,
  ) {}

  async send(request: HttpRequest) {
    this.requests.push(request);
    return ok(await this.responder(request, this.requests.length - 1));
  }
}

const secrets: ISecretStore = {
  put: async (profileId, kind) => ok({ profileId, kind, present: true }),
  describe: async (profileId, kind) => ({ profileId, kind, present: true }),
  delete: async () => undefined,
  reveal: async (_profileId, kind) => (kind === 'apiKey' ? 'test-api-key' : undefined),
};

function profileFor(provider: ProviderId, overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  const preset = PROVIDER_PRESETS[provider];
  const resolved = resolveEffectiveProfile({
    id: `p-${provider}`,
    label: provider,
    provider,
    dialect: preset.dialect,
    baseUrl: preset.baseUrl,
    model: preset.modelHint,
    contextWindow: preset.defaultContextWindow,
    temperature: 0.2,
    maxOutputTokens: 256,
    ...overrides,
  });
  if (!resolved.ok) {
    throw new Error(`profile ${provider} rejected: ${resolved.error.message}`);
  }
  return resolved.value;
}

function registry(http: IHttpClient): ProviderRegistry {
  return new ProviderRegistry(http, new AuthResolver(secrets));
}

function request(profile: ProviderProfile, overrides: Partial<GenerateRequest> = {}): GenerateRequest {
  return {
    model: profile.model,
    system: 'system prompt',
    user: 'user prompt',
    maxOutputTokens: 256,
    temperature: 0.2,
    timeoutMs: 1234,
    maxRetries: 0,
    signal: neverCancelled,
    ...overrides,
  };
}

function completion(text: string): HttpResponse {
  return {
    status: 200,
    headers: {},
    text: JSON.stringify({
      id: 'req',
      choices: [{ message: { content: text }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 4 },
    }),
  };
}

describe.each(['deepseek', 'openai', 'openrouter'] as const)('%s (OpenAI-compatible)', (provider) => {
  it('builds an OpenAI chat request and parses the completion', async () => {
    const profile = profileFor(provider);
    const http = new MockHttp(() => completion('feat: add thing'));
    const result = await registry(http).get(profile).generate(profile, request(profile));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.text).toBe('feat: add thing');
      expect(result.value.usage).toEqual({ input: 10, output: 4 });
    }
    const sent = http.requests[0];
    expect(sent.url).toBe(`${profile.baseUrl}/chat/completions`);
    expect(sent.headers['authorization']).toBe('Bearer test-api-key');
    expect(sent.timeoutMs).toBe(1234);
    const body = JSON.parse(sent.body ?? '{}') as Record<string, unknown>;
    expect(body['model']).toBe(profile.model);
    expect(body['stream']).toBe(false);
  });
});

describe('Anthropic', () => {
  it('uses the messages endpoint, version header and system field', async () => {
    const profile = profileFor('anthropic');
    const http = new MockHttp(() => ({
      status: 200,
      headers: {},
      text: JSON.stringify({ content: [{ type: 'text', text: 'fix: handle it' }], stop_reason: 'end_turn' }),
    }));

    const result = await registry(http).get(profile).generate(profile, request(profile));
    expect(result.ok && result.value.text).toBe('fix: handle it');

    const sent = http.requests[0];
    expect(sent.url).toBe(`${profile.baseUrl}/v1/messages`);
    expect(sent.headers['x-api-key']).toBe('test-api-key');
    expect(sent.headers['authorization']).toBeUndefined();
    expect(sent.headers['anthropic-version']).toBeDefined();
    const body = JSON.parse(sent.body ?? '{}') as Record<string, unknown>;
    expect(body['system']).toBe('system prompt');
    expect(body['max_tokens']).toBe(256);
  });
});

describe('Gemini', () => {
  it('puts the key in a header, never in the URL', async () => {
    const profile = profileFor('gemini');
    const http = new MockHttp(() => ({
      status: 200,
      headers: {},
      text: JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'docs: explain it' }] }, finishReason: 'STOP' }],
      }),
    }));

    const result = await registry(http).get(profile).generate(profile, request(profile));
    expect(result.ok && result.value.text).toBe('docs: explain it');

    const sent = http.requests[0];
    expect(sent.url).toContain(`/v1beta/models/${profile.model}:generateContent`);
    expect(sent.url).not.toContain('test-api-key');
    expect(sent.headers['x-goog-api-key']).toBe('test-api-key');
    const body = JSON.parse(sent.body ?? '{}') as Record<string, unknown>;
    expect(body['systemInstruction']).toBeDefined();
  });
});

describe('Ollama (native API)', () => {
  it('uses /api/chat and the native options envelope', async () => {
    const profile = profileFor('ollama');
    const http = new MockHttp(() => ({
      status: 200,
      headers: {},
      text: JSON.stringify({ message: { role: 'assistant', content: 'chore: local run' }, done: true }),
    }));

    const result = await registry(http).get(profile).generate(profile, request(profile));
    expect(result.ok && result.value.text).toBe('chore: local run');

    const sent = http.requests[0];
    expect(sent.url).toBe(`${profile.baseUrl}/api/chat`);
    expect(sent.headers['authorization']).toBeUndefined();
    const body = JSON.parse(sent.body ?? '{}') as Record<string, unknown>;
    const options = body['options'] as Record<string, unknown>;
    expect(options['num_predict']).toBe(256);
    expect(body['stream']).toBe(false);
  });

  it('lists models from /api/tags', async () => {
    const profile = profileFor('ollama');
    const http = new MockHttp(() => ({
      status: 200,
      headers: {},
      text: JSON.stringify({ models: [{ name: 'qwen2.5-coder:7b' }] }),
    }));

    const result = await registry(http).get(profile).listModels(profile, neverCancelled);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([{ id: 'qwen2.5-coder:7b', label: 'qwen2.5-coder:7b' }]);
    }
    expect(http.requests[0].url).toBe(`${profile.baseUrl}/api/tags`);
  });
});

describe('OpenCode (session API)', () => {
  it('creates a session, sends one message and deletes the session', async () => {
    const profile = profileFor('opencode', { model: 'anthropic/claude-test' });
    const http = new MockHttp((req) => {
      if (req.method === 'POST' && req.url.endsWith('/session')) {
        return { status: 200, headers: {}, text: JSON.stringify({ id: 'sess-1' }) };
      }
      if (req.method === 'POST' && req.url.includes('/message')) {
        return {
          status: 200,
          headers: {},
          text: JSON.stringify({ parts: [{ type: 'text', text: 'test: opencode run' }] }),
        };
      }
      return { status: 200, headers: {}, text: '{}' };
    });

    const result = await registry(http).get(profile).generate(profile, request(profile));
    expect(result.ok && result.value.text).toBe('test: opencode run');
    expect(http.requests.map((entry) => `${entry.method} ${entry.url.replace(profile.baseUrl, '')}`)).toEqual([
      'POST /session',
      'POST /session/sess-1/message',
      'DELETE /session/sess-1',
    ]);
    expect(http.requests[0].headers['authorization']).toBeUndefined();

    const body = JSON.parse(http.requests[1].body ?? '{}') as Record<string, unknown>;
    expect(body['model']).toEqual({ providerID: 'anthropic', modelID: 'claude-test' });
  });

  it('rejects a model id without provider prefix', async () => {
    const profile = profileFor('opencode', { model: 'claude-test' });
    const http = new MockHttp(() => ({ status: 200, headers: {}, text: '{}' }));
    const result = await registry(http).get(profile).generate(profile, request(profile));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('profile_invalid');
    }
    expect(http.requests).toHaveLength(0);
  });
});

describe('Custom provider', () => {
  it('supports an OpenAI-compatible endpoint with a custom auth header', async () => {
    const profile = profileFor('custom', {
      dialect: 'openai-chat',
      baseUrl: 'https://llm.internal.example/v1',
      model: 'internal-model',
      authStyle: 'api-key-header',
      authHeaderName: 'X-Api-Key',
    });
    const http = new MockHttp(() => completion('refactor: custom endpoint'));

    const result = await registry(http).get(profile).generate(profile, request(profile));
    expect(result.ok && result.value.text).toBe('refactor: custom endpoint');

    const sent = http.requests[0];
    expect(sent.url).toBe('https://llm.internal.example/v1/chat/completions');
    expect(sent.headers['X-Api-Key']).toBe('test-api-key');
    expect(sent.headers['authorization']).toBeUndefined();
  });

  it('supports a custom endpoint that speaks the Anthropic format', async () => {
    const profile = profileFor('custom', {
      dialect: 'anthropic-messages',
      baseUrl: 'https://llm.internal.example',
      model: 'claude-proxy',
    });
    const http = new MockHttp(() => ({
      status: 200,
      headers: {},
      text: JSON.stringify({ content: [{ type: 'text', text: 'ci: custom format' }] }),
    }));

    const result = await registry(http).get(profile).generate(profile, request(profile));
    expect(result.ok && result.value.text).toBe('ci: custom format');
    expect(http.requests[0].url).toBe('https://llm.internal.example/v1/messages');
    expect(http.requests[0].headers['anthropic-version']).toBeDefined();
  });

  it('supports endpoints without authentication', async () => {
    const profile = profileFor('custom', {
      dialect: 'openai-chat',
      baseUrl: 'http://127.0.0.1:8080/v1',
      model: 'local',
      authStyle: 'none',
    });
    const http = new MockHttp(() => completion('build: local endpoint'));
    const result = await registry(http).get(profile).generate(profile, request(profile));
    expect(result.ok).toBe(true);
    expect(http.requests[0].headers['authorization']).toBeUndefined();
  });
});

describe('Error handling across providers', () => {
  it('maps a 401 to a non-retryable auth error without leaking headers', async () => {
    const profile = profileFor('openai');
    const http = new MockHttp(() => ({ status: 401, headers: {}, text: '{"error":"bad key"}' }));
    const result = await registry(http).get(profile).generate(profile, request(profile));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('auth');
      expect(result.error.retryable).toBe(false);
      expect(JSON.stringify(result.error)).not.toContain('test-api-key');
    }
  });

  it('retries a 429 and succeeds when the provider recovers', async () => {
    const profile = profileFor('openai');
    const http = new MockHttp((_request, index) =>
      index === 0
        ? { status: 429, headers: { 'retry-after': '0' }, text: 'slow down' }
        : completion('fix: recovered'),
    );

    const result = await registry(http).get(profile).generate(profile, request(profile, { maxRetries: 1 }));
    expect(result.ok && result.value.text).toBe('fix: recovered');
    expect(http.requests).toHaveLength(2);
  });

  it('reports a missing API key before any network call', async () => {
    const profile = profileFor('deepseek');
    const noKey: ISecretStore = { ...secrets, reveal: async () => undefined };
    const http = new MockHttp(() => completion('never'));
    const result = await new ProviderRegistry(http, new AuthResolver(noKey))
      .get(profile)
      .generate(profile, request(profile));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('secret_missing');
    }
    expect(http.requests).toHaveLength(0);
  });
});
