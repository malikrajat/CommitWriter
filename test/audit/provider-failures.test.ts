import { createServer, type Server } from 'node:http';
import { describe, expect, it } from 'vitest';
import { CancelToken, neverCancelled } from '../../src/core/domain/cancel-signal.js';
import type { ProviderProfile } from '../../src/core/domain/provider-profile.js';
import { ok } from '../../src/core/domain/result.js';
import type { HttpRequest, HttpResponse, IHttpClient } from '../../src/core/ports/i-http-client.js';
import type { GenerateRequest } from '../../src/core/ports/i-provider.js';
import type { ISecretStore } from '../../src/core/ports/i-secret-store.js';
import { AuthResolver } from '../../src/providers/auth-resolver.js';
import { FetchHttpClient } from '../../src/providers/http/fetch-http-client.js';
import { RedactingHttpClient } from '../../src/providers/http/redacting-http-client.js';
import { PROVIDER_PRESETS } from '../../src/providers/presets.js';
import { resolveEffectiveProfile } from '../../src/providers/profile-resolver.js';
import { ProviderRegistry } from '../../src/providers/registry.js';

class MockHttp implements IHttpClient {
  readonly requests: HttpRequest[] = [];

  constructor(private readonly responder: (request: HttpRequest, call: number) => HttpResponse) {}

  async send(request: HttpRequest) {
    this.requests.push(request);
    return ok(this.responder(request, this.requests.length - 1));
  }
}

const secrets: ISecretStore = {
  put: async (profileId, kind) => ok({ profileId, kind, present: true }),
  describe: async (profileId, kind) => ({ profileId, kind, present: true }),
  delete: async () => undefined,
  reveal: async (_profileId, kind) => (kind === 'apiKey' ? 'test-api-key' : undefined),
};

function profile(): ProviderProfile {
  const preset = PROVIDER_PRESETS.openai;
  const resolved = resolveEffectiveProfile({
    id: 'audit',
    label: 'Audit',
    provider: 'openai',
    dialect: preset.dialect,
    baseUrl: preset.baseUrl,
    model: preset.modelHint,
    contextWindow: preset.defaultContextWindow,
    temperature: 0.2,
    maxOutputTokens: 256,
  });
  if (!resolved.ok) {
    throw new Error('invalid profile');
  }
  return resolved.value;
}

const request: GenerateRequest = {
  model: 'gpt-4o-mini',
  system: 'system',
  user: 'user',
  maxOutputTokens: 256,
  temperature: 0.2,
  timeoutMs: 1000,
  maxRetries: 0,
  signal: neverCancelled,
};

function provider(http: IHttpClient) {
  return new ProviderRegistry(http, new AuthResolver(secrets)).get(profile());
}

let server: Server | undefined;

async function startServer(delayMs: number): Promise<string> {
  server = createServer((_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    }, delayMs);
  });
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (typeof address === 'string' || address === null) {
    throw new Error('no port');
  }
  return `http://127.0.0.1:${address.port}`;
}

async function stopServer(): Promise<void> {
  if (!server) {
    return;
  }
  server.closeAllConnections();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = undefined;
}

describe('audit: provider failure scenarios', () => {
  it('10. surfaces timeouts as retryable errors', async () => {
    const base = await startServer(300);
    try {
      const client = new RedactingHttpClient(new FetchHttpClient());
      const result = await client.send({
        url: base,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
        timeoutMs: 40,
        signal: neverCancelled,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('timeout');
        expect(result.error.retryable).toBe(true);
      }
    } finally {
      await stopServer();
    }
  });

  it('11. maps an invalid API key to auth', async () => {
    const http = new MockHttp(() => ({ status: 401, headers: {}, text: '{"error":"invalid api key"}' }));
    const result = await provider(http).generate(profile(), request);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('auth');
      expect(result.error.retryable).toBe(false);
      expect(JSON.stringify(result.error)).not.toContain('test-api-key');
    }
  });

  it('12. surfaces rate limiting after the retry budget', async () => {
    const http = new MockHttp(() => ({ status: 429, headers: {}, text: 'slow down' }));
    const result = await provider(http).generate(profile(), request);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('rate_limit');
    }
  });

  it('13. surfaces provider unavailability (5xx) as retryable', async () => {
    const http = new MockHttp(() => ({ status: 503, headers: {}, text: 'unavailable' }));
    const result = await provider(http).generate(profile(), request);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('server');
      expect(result.error.retryable).toBe(true);
    }
  });

  it('14. stops before any request when cancelled', async () => {
    const token = new CancelToken();
    token.abort('user');
    const http = new MockHttp(() => ({ status: 200, headers: {}, text: '{}' }));
    const result = await provider(http).generate(profile(), { ...request, signal: token });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('cancelled');
    }
    expect(http.requests).toHaveLength(0);
  });

  it('16. reports a missing network as a retryable network error', async () => {
    const client = new FetchHttpClient();
    const result = await client.send({
      url: 'http://127.0.0.1:1',
      method: 'POST',
      headers: {},
      body: '{}',
      timeoutMs: 2000,
      signal: neverCancelled,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(['network', 'timeout']).toContain(result.error.code);
      expect(result.error.retryable).toBe(true);
    }
  });
});
