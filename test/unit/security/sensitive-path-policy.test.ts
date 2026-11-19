import { describe, expect, it } from 'vitest';
import { classifyPath, isBlocked } from '../../../src/core/security/sensitive-path-policy.js';

describe('sensitive path policy', () => {
  it('blocks environment and key material', () => {
    for (const path of [
      '.env',
      'apps/api/.env.production',
      'certs/server.pem',
      'keys/id_rsa',
      '.npmrc',
      '.aws/credentials',
      'config/secrets/db.yaml',
      'service-account-prod.json',
    ]) {
      expect(isBlocked(path), path).toBe(true);
    }
  });

  it('flags but allows suspicious paths', () => {
    expect(classifyPath('infra/kubeconfig').sensitivity).toBe('suspicious');
    expect(classifyPath('infra/prod.tfvars').sensitivity).toBe('suspicious');
  });

  it('leaves ordinary source files alone', () => {
    expect(classifyPath('src/git/diff-collector.ts').sensitivity).toBe('none');
    expect(classifyPath('README.md').sensitivity).toBe('none');
  });
});
