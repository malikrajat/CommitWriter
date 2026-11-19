import { describe, expect, it } from 'vitest';
import { evaluateUrl, isLoopbackHost } from '../../../src/core/security/url-policy.js';

describe('evaluateUrl', () => {
  it('accepts https endpoints', () => {
    const result = evaluateUrl('https://api.deepseek.com/v1', 'deepseek');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.origin).toBe('https://api.deepseek.com');
    }
  });

  it('accepts http only for loopback', () => {
    expect(evaluateUrl('http://127.0.0.1:11434/v1', 'ollama').ok).toBe(true);
    expect(evaluateUrl('http://localhost:4096', 'opencode').ok).toBe(true);
    expect(evaluateUrl('http://[::1]:8080', 'custom').ok).toBe(true);
  });

  it('rejects plain http to a remote host', () => {
    const result = evaluateUrl('http://api.example.com/v1', 'custom');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('url_rejected');
    }
  });

  it('rejects credentials in the URL', () => {
    expect(evaluateUrl('https://user:pass@example.com', 'custom').ok).toBe(false);
  });

  it('rejects metadata and link-local addresses', () => {
    expect(evaluateUrl('http://169.254.169.254/latest/meta-data', 'custom').ok).toBe(false);
    expect(evaluateUrl('https://100.100.100.200', 'custom').ok).toBe(false);
  });

  it('rejects non-http schemes and garbage', () => {
    expect(evaluateUrl('file:///etc/passwd', 'custom').ok).toBe(false);
    expect(evaluateUrl('not a url', 'custom').ok).toBe(false);
  });

  it('enforces local-only mode', () => {
    expect(evaluateUrl('https://api.openai.com/v1', 'openai', { localOnly: true }).ok).toBe(false);
    expect(evaluateUrl('http://127.0.0.1:11434', 'ollama', { localOnly: true }).ok).toBe(true);
    expect(evaluateUrl('http://localhost:1234/v1', 'lmstudio', { localOnly: true }).ok).toBe(true);
    expect(evaluateUrl('https://api.openai.com/v1', 'openai', { localOnly: false }).ok).toBe(true);
  });

  it('knows loopback hosts', () => {
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('127.0.0.5')).toBe(true);
    expect(isLoopbackHost('example.com')).toBe(false);
  });
});
