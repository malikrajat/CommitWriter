import { describe, expect, it } from 'vitest';
import { describeConnectionError } from '../../../src/config/settings-controller.js';
import { appError } from '../../../src/core/domain/errors.js';
import type { ProviderProfile } from '../../../src/core/domain/provider-profile.js';

const profile: ProviderProfile = {
  id: 'work',
  label: 'Work',
  provider: 'openai',
  dialect: 'openai-chat',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  contextWindow: 128000,
  temperature: 0.2,
  maxOutputTokens: 512,
};

describe('describeConnectionError', () => {
  it('points to the API key command when the secret is missing', () => {
    const message = describeConnectionError(
      appError('secret_missing', 'missing', { providerId: 'openai' }),
      profile,
    );
    expect(message).toContain('No API key');
    expect(message).toContain('Set API Key');
  });

  it('explains authentication failures with the status code', () => {
    const message = describeConnectionError(
      appError('auth', 'x', { httpStatus: 401, providerId: 'openai' }),
      profile,
    );
    expect(message).toContain('Authentication failed');
    expect(message).toContain('401');
    expect(message).toContain('Work');
  });

  it('names the origin for network failures', () => {
    const message = describeConnectionError(appError('network', 'x'), profile);
    expect(message).toContain('https://api.openai.com');
    expect(message).toContain('Cannot reach');
  });

  it('explains TLS failures without suggesting a bypass', () => {
    const message = describeConnectionError(appError('tls', 'x'), profile);
    expect(message).toContain('certificate');
    expect(message.toLowerCase()).not.toContain('ignore');
  });

  it('explains timeouts and rate limits', () => {
    expect(describeConnectionError(appError('timeout', 'x'), profile)).toContain('timed out');
    expect(describeConnectionError(appError('rate_limit', 'x'), profile)).toContain('rate limiting');
  });
});
