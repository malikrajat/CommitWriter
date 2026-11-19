import { describe, expect, it } from 'vitest';
import type { OutputChannel } from 'vscode';
import { validateProfile, type ProviderProfile } from '../../src/core/domain/provider-profile.js';
import { redactSecrets } from '../../src/core/security/secret-redactor.js';
import { evaluateUrl } from '../../src/core/security/url-policy.js';
import { describeConnectionError } from '../../src/config/settings-controller.js';
import { appError } from '../../src/core/domain/errors.js';
import { RedactingLogger } from '../../src/logging/redacting-logger.js';
import { normalizeProviderError } from '../../src/providers/error-normalizer.js';
import { RedactingHttpClient } from '../../src/providers/http/redacting-http-client.js';
import type { HttpRequest, HttpResponse, IHttpClient } from '../../src/core/ports/i-http-client.js';
import { ok } from '../../src/core/domain/result.js';

const diffWithSecrets = [
  'diff --git a/.env b/.env',
  '+AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE',
  '+AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  '+DATABASE_URL=postgres://admin:hunter2@db.internal:5432/app',
  '+GITHUB_TOKEN=ghp_0123456789012345678901234567890123456789',
  '+JWT=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
  '+-----BEGIN RSA PRIVATE KEY-----',
  '+MIIEowIBAAKCAQEA',
  '+-----END RSA PRIVATE KEY-----',
].join('\n');

function capture(): { channel: OutputChannel; lines: string[] } {
  const lines: string[] = [];
  return {
    channel: {
      name: 'audit',
      append: () => undefined,
      appendLine: (line: string) => lines.push(line),
      replace: () => undefined,
      clear: () => undefined,
      show: () => undefined,
      hide: () => undefined,
      dispose: () => undefined,
    } as unknown as OutputChannel,
    lines,
  };
}

class CapturingHttp implements IHttpClient {
  last: HttpRequest | undefined;

  constructor(private readonly response: HttpResponse) {}

  async send(request: HttpRequest) {
    this.last = request;
    return ok(this.response);
  }
}

describe('audit: credential protection', () => {
  it('redacts every credential shape found in a diff', () => {
    const result = redactSecrets(diffWithSecrets);
    expect(result.text).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(result.text).not.toContain('wJalrXUtnFEMI');
    expect(result.text).not.toContain('hunter2');
    expect(result.text).not.toContain('ghp_0123456789');
    expect(result.text).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(result.text).not.toContain('MIIEowIBAAKCAQEA');
    expect(result.redactions).toBeGreaterThan(0);
  });

  it('redacts the outgoing request body before the transport sees it', async () => {
    const inner = new CapturingHttp({ status: 200, headers: {}, text: 'ok' });
    const client = new RedactingHttpClient(inner);
    await client.send({
      url: 'https://api.example.com/v1/chat/completions',
      method: 'POST',
      headers: { authorization: 'Bearer sk-real-key' },
      body: JSON.stringify({ messages: [{ role: 'user', content: diffWithSecrets }] }),
      timeoutMs: 1000,
      signal: { aborted: false, onAbort: () => ({ dispose: () => undefined }) },
    });

    const sent = inner.last?.body ?? '';
    expect(sent).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(sent).not.toContain('hunter2');
    expect(sent).not.toContain('ghp_0123456789');
  });

  it('never logs headers, keys, prompts or diff content', () => {
    const { channel, lines } = capture();
    const logger = new RedactingLogger(channel, () => 'debug');
    logger.info('request', {
      providerId: 'openai',
      authorization: 'Bearer sk-secret',
      headers: 'x-api-key: sk-secret',
      diff: diffWithSecrets,
      prompt: 'system prompt',
      model: 'gpt-4o-mini',
    });

    const output = lines.join('\n');
    expect(output).not.toContain('sk-secret');
    expect(output).not.toContain('AKIA');
    expect(output).not.toContain('hunter2');
    expect(output).not.toContain('x-api-key');
    expect(output).toContain('openai');
    expect(output).toContain('gpt-4o-mini');
  });

  it('redacts secrets echoed back in a provider error', () => {
    const error = normalizeProviderError({
      status: 400,
      detail: 'bad request for key sk-abcdefghijklmnopqrstuvwxyz and password=hunter2',
      providerId: 'openai',
      model: 'gpt-4o-mini',
    });
    expect(error.cause ?? '').not.toContain('sk-abcdefghijklmnopqrstuvwxyz');
    expect(error.cause ?? '').not.toContain('hunter2');
  });

  it('keeps credentials out of the model-facing error message', () => {
    const error = normalizeProviderError({
      status: 401,
      detail: 'invalid key sk-abcdefghijklmnopqrstuvwxyz',
      providerId: 'openai',
    });
    expect(error.message).not.toContain('sk-');
    expect(error.message).toContain('Authentication failed');
  });

  it('rejects credential headers in provider configuration', () => {
    const profile: ProviderProfile = {
      id: 'audit',
      label: 'Audit',
      provider: 'custom',
      dialect: 'openai-chat',
      baseUrl: 'https://llm.example.com/v1',
      model: 'm',
      contextWindow: 32000,
      temperature: 0.2,
      maxOutputTokens: 256,
      headers: { Authorization: 'Bearer leaked' },
    };
    expect(validateProfile(profile).valid).toBe(false);
  });

  it('validates custom endpoints and blocks unsafe targets', () => {
    expect(evaluateUrl('https://llm.example.com/v1', 'custom').ok).toBe(true);
    expect(evaluateUrl('http://llm.example.com/v1', 'custom').ok).toBe(false);
    expect(evaluateUrl('http://127.0.0.1:11434', 'ollama').ok).toBe(true);
    expect(evaluateUrl('http://169.254.169.254/latest', 'custom').ok).toBe(false);
    expect(evaluateUrl('https://user:pass@llm.example.com', 'custom').ok).toBe(false);
    expect(evaluateUrl('file:///etc/passwd', 'custom').ok).toBe(false);
  });

  it('does not suggest disabling TLS validation on failure', () => {
    const message = describeConnectionError(appError('tls', 'x'), {
      id: 'audit',
      label: 'Audit',
      provider: 'openai',
      dialect: 'openai-chat',
      baseUrl: 'https://api.openai.com/v1',
      model: 'm',
      contextWindow: 32000,
      temperature: 0.2,
      maxOutputTokens: 256,
    });
    expect(message.toLowerCase()).not.toContain('ignore');
    expect(message.toLowerCase()).not.toContain('rejectunauthorized');
  });
});
