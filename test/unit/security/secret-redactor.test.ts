import { describe, expect, it } from 'vitest';
import { redactSecrets } from '../../../src/core/security/secret-redactor.js';

describe('redactSecrets', () => {
  it('redacts PEM private keys', () => {
    const input = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----';
    const result = redactSecrets(input);
    expect(result.text).toBe('[REDACTED:private-key]');
    expect(result.redactions).toBe(1);
  });

  it('redacts common provider tokens', () => {
    const input = [
      'aws=AKIAIOSFODNN7EXAMPLE',
      'gh=ghp_0123456789012345678901234567890123456',
      'openai=sk-proj-012345678901234567890123456789',
      'slack=xoxb-1234567890-abcdefghij',
      'google=AIzaSyA1234567890123456789012345678901234',
    ].join('\n');
    const result = redactSecrets(input);
    expect(result.text).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(result.text).not.toContain('ghp_0123456789');
    expect(result.text).not.toContain('sk-proj');
    expect(result.text).not.toContain('xoxb-');
    expect(result.text).not.toContain('AIzaSy');
    expect(result.redactions).toBeGreaterThanOrEqual(5);
  });

  it('redacts assignment-style secrets but keeps the key name', () => {
    const result = redactSecrets('DATABASE_PASSWORD="hunter2hunter2"');
    expect(result.text).toContain('DATABASE_PASSWORD');
    expect(result.text).not.toContain('hunter2hunter2');
  });

  it('redacts credentials embedded in connection strings', () => {
    const result = redactSecrets('postgres://admin:supersecret@db.internal:5432/app');
    expect(result.text).not.toContain('supersecret');
    expect(result.text).toContain('db.internal');
  });

  it('does not redact git object ids or short identifiers', () => {
    const input = 'commit 3f9a1c2b4d5e6f708192a3b4c5d6e7f8091a2b3c and file src/git/a.ts';
    const result = redactSecrets(input);
    expect(result.text).toBe(input);
    expect(result.redactions).toBe(0);
  });

  it('is idempotent', () => {
    const once = redactSecrets('password=abcdef123456').text;
    const twice = redactSecrets(once).text;
    expect(twice).toBe(once);
  });
});
