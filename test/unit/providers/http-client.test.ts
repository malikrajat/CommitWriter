import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { CancelToken, neverCancelled } from '../../../src/core/domain/cancel-signal.js';
import type { HttpRequest, HttpResponse, IHttpClient } from '../../../src/core/ports/i-http-client.js';
import { ok } from '../../../src/core/domain/result.js';
import type { Result } from '../../../src/core/domain/result.js';
import { FetchHttpClient } from '../../../src/providers/http/fetch-http-client.js';
import { RedactingHttpClient } from '../../../src/providers/http/redacting-http-client.js';

let server: Server | undefined;

async function start(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> {
  server = createServer(handler);
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (typeof address === 'string' || address === null) {
    throw new Error('no ephemeral port');
  }
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  if (!server) {
    return;
  }
  server.closeAllConnections();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = undefined;
});

function request(url: string, overrides: Partial<HttpRequest> = {}): HttpRequest {
  return {
    url,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"a":1}',
    timeoutMs: 2000,
    signal: neverCancelled,
    ...overrides,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('FetchHttpClient', () => {
  it('returns status, headers and body', async () => {
    const base = await start((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'x-request-id': 'abc' });
      res.end('{"ok":true}');
    });
    const result = await new FetchHttpClient().send(request(base));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe(200);
      expect(result.value.text).toBe('{"ok":true}');
      expect(result.value.headers['x-request-id']).toBe('abc');
    }
  });

  it('never follows redirects', async () => {
    let secondHit = false;
    const target = await start((_req, res) => {
      secondHit = true;
      res.writeHead(200);
      res.end('should not be reached');
    });
    const base = await start((_req, res) => {
      res.writeHead(302, { location: target });
      res.end();
    });

    const result = await new FetchHttpClient().send(request(base));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('bad_request');
      expect(result.error.httpStatus).toBe(302);
    }
    expect(secondHit).toBe(false);
  });

  it('times out', async () => {
    const base = await start(async (_req, res) => {
      await delay(300);
      res.writeHead(200);
      res.end('late');
    });
    const result = await new FetchHttpClient().send(request(base, { timeoutMs: 30 }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('timeout');
      expect(result.error.retryable).toBe(true);
    }
  });

  it('honours cancellation', async () => {
    const base = await start(async (_req, res) => {
      await delay(500);
      res.writeHead(200);
      res.end('late');
    });
    const token = new CancelToken();
    setTimeout(() => token.abort('user'), 25);
    const result = await new FetchHttpClient().send(request(base, { signal: token, timeoutMs: 5000 }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('cancelled');
    }
  });

  it('reports unreachable endpoints as network errors', async () => {
    const result = await new FetchHttpClient().send(request('http://127.0.0.1:1', { timeoutMs: 3000 }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(['network', 'timeout']).toContain(result.error.code);
      expect(result.error.retryable).toBe(true);
    }
  });
});

class CapturingClient implements IHttpClient {
  last: HttpRequest | undefined;

  constructor(private readonly response: HttpResponse) {}

  async send(request: HttpRequest): Promise<Result<HttpResponse, never>> {
    this.last = request;
    return ok(this.response);
  }
}

describe('RedactingHttpClient', () => {
  it('redacts the request body before it reaches the transport', async () => {
    const inner = new CapturingClient({ status: 200, headers: {}, text: 'ok' });
    const client = new RedactingHttpClient(inner);
    await client.send(
      request('https://example.com', { body: '{"password":"hunter2hunter2","key":"ghp_0123456789012345678901234567890123456789"}' }),
    );
    expect(inner.last?.body).not.toContain('hunter2hunter2');
    expect(inner.last?.body).not.toContain('ghp_0123456789');
    expect(inner.last?.body).toContain('[REDACTED');
  });

  it('redacts error responses but leaves successful bodies intact', async () => {
    const errorInner = new CapturingClient({
      status: 401,
      headers: {},
      text: 'invalid key sk-abcdefghijklmnopqrstuvwxyz',
    });
    const errorResult = await new RedactingHttpClient(errorInner).send(request('https://example.com'));
    expect(errorResult.ok).toBe(true);
    if (errorResult.ok) {
      expect(errorResult.value.text).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');
    }

    const okInner = new CapturingClient({ status: 200, headers: {}, text: 'feat: add sk-lookalike-token-here' });
    const okResult = await new RedactingHttpClient(okInner).send(request('https://example.com'));
    expect(okResult.ok).toBe(true);
    if (okResult.ok) {
      expect(okResult.value.text).toBe('feat: add sk-lookalike-token-here');
    }
  });
});
