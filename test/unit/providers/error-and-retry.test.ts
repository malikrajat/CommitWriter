import { describe, expect, it } from 'vitest';
import { normalizeProviderError } from '../../../src/providers/error-normalizer.js';
import { backoffMs, parseRetryAfterMs, shouldRetry } from '../../../src/providers/retry-policy.js';

describe('normalizeProviderError', () => {
  it('maps auth failures', () => {
    const error = normalizeProviderError({ status: 401, detail: 'invalid key', providerId: 'openai' });
    expect(error.code).toBe('auth');
    expect(error.retryable).toBe(false);
  });

  it('maps rate limits as retryable', () => {
    const error = normalizeProviderError({ status: 429, detail: 'slow down', providerId: 'openai' });
    expect(error.code).toBe('rate_limit');
    expect(error.retryable).toBe(true);
  });

  it('distinguishes quota from rate limiting', () => {
    const error = normalizeProviderError({ status: 429, detail: 'insufficient credit', providerId: 'openai' });
    expect(error.code).toBe('quota');
  });

  it('maps server errors as retryable', () => {
    expect(normalizeProviderError({ status: 503, detail: 'down', providerId: 'x' }).retryable).toBe(true);
  });

  it('detects context overflow from body text and 413', () => {
    expect(normalizeProviderError({ status: 400, detail: 'maximum context length exceeded', providerId: 'x' }).code).toBe(
      'context_overflow',
    );
    expect(normalizeProviderError({ status: 413, detail: 'too large', providerId: 'x' }).code).toBe('context_overflow');
  });

  it('names the model on 404 without leaking provider text', () => {
    const error = normalizeProviderError({ status: 404, detail: 'no such model', providerId: 'x', model: 'm1' });
    expect(error.code).toBe('bad_request');
    expect(error.message).toContain('m1');
    expect(error.message).not.toContain('no such model');
  });

  it('redacts credentials that a provider echoes back', () => {
    const error = normalizeProviderError({
      status: 400,
      detail: 'bad request with key sk-abcdefghijklmnopqrstuvwxyz',
      providerId: 'x',
    });
    expect(error.cause ?? '').not.toContain('sk-abcdefghijklmnopqrstuvwxyz');
  });
});

describe('retry policy', () => {
  it('retries only retryable errors within the budget', () => {
    const retryable = { code: 'rate_limit' as const, message: 'x', retryable: true };
    expect(shouldRetry(retryable, 0, 2)).toBe(true);
    expect(shouldRetry(retryable, 1, 2)).toBe(true);
    expect(shouldRetry(retryable, 2, 2)).toBe(false);
    expect(shouldRetry({ ...retryable, retryable: false }, 0, 2)).toBe(false);
  });

  it('grows the backoff but caps it', () => {
    expect(backoffMs(0, 1000)).toBe(1000);
    expect(backoffMs(10)).toBeLessThanOrEqual(8000);
  });

  it('honours Retry-After in seconds', () => {
    expect(parseRetryAfterMs({ 'retry-after': '2' })).toBe(2000);
    expect(parseRetryAfterMs({})).toBeUndefined();
  });
});
