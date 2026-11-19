import { afterEach, describe, expect, it } from 'vitest';
import type { Uri } from 'vscode';
import type { GitAPI, GitRepository } from '../../../src/git/git-types.js';
import { RepositoryResolver } from '../../../src/git/repository-resolver.js';
import { setActiveTextEditor } from '../../support/vscode-stub.js';

function uri(fsPath: string): Uri {
  return { fsPath } as unknown as Uri;
}

function repository(root: string, opts: { selected?: boolean; kind?: string } = {}): GitRepository {
  return {
    rootUri: uri(root),
    kind: opts.kind ?? 'repository',
    inputBox: { value: '' },
    isUsingVirtualFileSystem: false,
    state: {
      HEAD: { name: 'main', commit: 'abc' },
      indexChanges: [],
      workingTreeChanges: [],
      untrackedChanges: [],
      mergeChanges: [],
      onDidChange: () => ({ dispose: () => undefined }),
    },
    ui: { selected: opts.selected ?? false, onDidChange: () => ({ dispose: () => undefined }) },
    diffIndexWithHEAD: async () => '',
    diffWithHEAD: async () => '',
    checkIgnore: async () => new Set<string>(),
    log: async () => [],
  } as unknown as GitRepository;
}

function api(repositories: readonly GitRepository[]): GitAPI {
  return {
    state: 'initialized',
    onDidChangeState: () => ({ dispose: () => undefined }),
    repositories,
    git: { path: 'git' },
    getRepository: (target: Uri) =>
      repositories.find(
        (entry) =>
          target.fsPath === entry.rootUri.fsPath ||
          target.fsPath.startsWith(`${entry.rootUri.fsPath}\\`) ||
          target.fsPath.startsWith(`${entry.rootUri.fsPath}/`),
      ) ?? null,
    init: async () => null,
  } as GitAPI;
}

afterEach(() => {
  setActiveTextEditor(undefined);
});

describe('RepositoryResolver', () => {
  it('prefers the repository of the active editor', () => {
    const a = repository('C:\\work\\a');
    const b = repository('C:\\work\\b', { selected: true });
    setActiveTextEditor({ document: { uri: uri('C:\\work\\a\\src\\file.ts') } });

    const resolver = new RepositoryResolver(api([a, b]));
    expect(resolver.resolve()?.rootUri.fsPath).toBe('C:\\work\\a');
  });

  it('falls back to the repository selected in Source Control', () => {
    const a = repository('C:\\work\\a');
    const b = repository('C:\\work\\b', { selected: true });
    const resolver = new RepositoryResolver(api([a, b]));
    expect(resolver.resolve()?.rootUri.fsPath).toBe('C:\\work\\b');
  });

  it('uses the only repository without prompting', () => {
    const a = repository('C:\\work\\a');
    const resolver = new RepositoryResolver(api([a]));
    expect(resolver.resolve()).toBe(a);
  });

  it('returns undefined when several repositories exist and none is selected', () => {
    const resolver = new RepositoryResolver(api([repository('C:\\work\\a'), repository('C:\\work\\b')]));
    expect(resolver.resolve()).toBeUndefined();
    expect(resolver.choices()).toHaveLength(2);
  });

  it('ignores submodules', () => {
    const submodule = repository('C:\\work\\lib', { kind: 'submodule' });
    const root = repository('C:\\work\\app');
    const resolver = new RepositoryResolver(api([submodule, root]));
    expect(resolver.all()).toEqual([root]);
    expect(resolver.resolve()).toBe(root);
  });

  it('finds a repository by root path', () => {
    const a = repository('C:\\work\\a');
    const resolver = new RepositoryResolver(api([a]));
    expect(resolver.byRootPath('C:\\work\\a')).toBe(a);
    expect(resolver.byRootPath('C:\\work\\missing')).toBeUndefined();
  });
});
