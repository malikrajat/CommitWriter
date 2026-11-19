import { describe, expect, it } from 'vitest';
import { isForbiddenHeader, validateProfile, type ProviderProfile } from '../../../src/core/domain/provider-profile.js';

function profile(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: 'work',
    label: 'Work',
    provider: 'custom',
    dialect: 'openai-chat',
    baseUrl: 'https://llm.internal/v1',
    model: 'internal-model',
    contextWindow: 32000,
    temperature: 0.2,
    maxOutputTokens: 512,
    ...overrides,
  };
}

describe('provider profile validation', () => {
  it('accepts a valid profile', () => {
    expect(validateProfile(profile()).valid).toBe(true);
  });

  it('rejects a custom auth header that is reserved', () => {
    const result = validateProfile(
      profile({ authStyle: 'api-key-header', authHeaderName: 'authorization' }),
    );
    expect(result.valid).toBe(false);
    expect(result.problems.join(' ')).toContain('cannot carry credentials');
  });

  it('rejects malformed header names', () => {
    const result = validateProfile(
      profile({ authStyle: 'api-key-header', authHeaderName: 'X Key: value' }),
    );
    expect(result.valid).toBe(false);
    expect(result.problems.join(' ')).toContain('valid HTTP header name');
  });

  it('accepts a custom auth header', () => {
    expect(
      validateProfile(profile({ authStyle: 'api-key-header', authHeaderName: 'X-Api-Key' })).valid,
    ).toBe(true);
  });

  it('rejects credential headers in the static header map', () => {
    const result = validateProfile(profile({ headers: { Authorization: 'Bearer leaked' } }));
    expect(result.valid).toBe(false);
    expect(result.problems.join(' ')).toContain('reserved for credentials');
  });

  it('recognises forbidden header names case-insensitively', () => {
    expect(isForbiddenHeader('AUTHORIZATION')).toBe(true);
    expect(isForbiddenHeader('x-goog-api-key')).toBe(true);
    expect(isForbiddenHeader('x-trace-id')).toBe(false);
  });

  it('requires a non-empty model and base URL', () => {
    expect(validateProfile(profile({ model: '  ' })).valid).toBe(false);
    expect(validateProfile(profile({ baseUrl: '' })).valid).toBe(false);
  });

  it('rejects invalid profile identifiers', () => {
    expect(validateProfile(profile({ id: 'Bad Id' })).valid).toBe(false);
  });
});
