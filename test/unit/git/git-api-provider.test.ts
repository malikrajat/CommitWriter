import { afterEach, describe, expect, it } from 'vitest';
import type { GitAPI } from '../../../src/git/git-types.js';
import { GitApiProvider } from '../../../src/git/git-api-provider.js';
import { nullLogger } from '../../../src/core/ports/i-logger.js';
import { setExtension } from '../../support/vscode-stub.js';

function api(overrides: Partial<GitAPI> = {}): GitAPI {
  return {
    state: 'initialized',
    onDidChangeState: () => ({ dispose: () => undefined }),
    repositories: [],
    git: { path: 'git' },
    getRepository: () => null,
    init: async () => null,
    ...overrides,
  } as GitAPI;
}

afterEach(() => {
  setExtension(undefined);
});

describe('GitApiProvider', () => {
  it('reports a clear error when the Git extension is not installed', async () => {
    const result = await new GitApiProvider(nullLogger).get();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('git_disabled');
      expect(result.error.message).toContain('Git extension');
    }
  });

  it('reports a clear error when the Git extension is disabled', async () => {
    setExtension({ isActive: true, exports: { enabled: false } });
    const result = await new GitApiProvider(nullLogger).get();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('git_disabled');
    }
  });

  it('returns the API once it is initialized', async () => {
    const instance = api({ repositories: [] });
    setExtension({
      isActive: true,
      exports: { enabled: true, getAPI: () => instance },
    });

    const result = await new GitApiProvider(nullLogger).get();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(instance);
    }
  });

  it('activates the extension when it is not active yet', async () => {
    let activated = false;
    const instance = api();
    setExtension({
      isActive: false,
      activate: async () => {
        activated = true;
      },
      exports: { enabled: true, getAPI: () => instance },
    });

    const result = await new GitApiProvider(nullLogger).get();
    expect(result.ok).toBe(true);
    expect(activated).toBe(true);
  });

  it('fails when the API never finishes initializing', async () => {
    const instance = api({ state: 'uninitialized' });
    setExtension({
      isActive: true,
      exports: { enabled: true, getAPI: () => instance },
    });

    const result = await new GitApiProvider(nullLogger, 25).get();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('no_repository');
    }
  });

  it('caches a successful API instance', async () => {
    let calls = 0;
    const instance = api();
    setExtension({
      isActive: true,
      exports: {
        enabled: true,
        getAPI: () => {
          calls += 1;
          return instance;
        },
      },
    });

    const provider = new GitApiProvider(nullLogger);
    const first = await provider.get();
    const second = await provider.get();
    expect(first.ok && second.ok).toBe(true);
    expect(calls).toBe(1);
  });
});
