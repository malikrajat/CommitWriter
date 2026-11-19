import { describe, expect, it } from 'vitest';
import type { Uri } from 'vscode';
import { neverCancelled } from '../../../src/core/domain/cancel-signal.js';
import { GIT_STATUS, type GitChange, type GitRepository } from '../../../src/git/git-types.js';
import type { FileReader, FileReadResult } from '../../../src/git/file-reader.js';
import { VscodeGitRepository } from '../../../src/git/vscode-git-repository.js';

const ROOT = 'C:\\work\\repo';

function uri(fsPath: string): Uri {
  return { fsPath } as unknown as Uri;
}

function change(path: string, status: number, renameFrom?: string): GitChange {
  const toNative = (value: string): string => `${ROOT}\\${value.replace(/\//g, '\\')}`;
  return {
    uri: uri(toNative(path)),
    originalUri: uri(toNative(renameFrom ?? path)),
    renameUri: renameFrom ? uri(toNative(renameFrom)) : undefined,
    status,
  };
}

function event(): () => { dispose: () => void } {
  return () => ({ dispose: () => undefined });
}

function repository(overrides: Partial<GitRepository> = {}): GitRepository {
  const base = {
    rootUri: uri(ROOT),
    inputBox: { value: '' },
    kind: 'repository',
    isUsingVirtualFileSystem: false,
    state: {
      HEAD: { name: 'main', commit: 'abc123' },
      indexChanges: [] as GitChange[],
      workingTreeChanges: [] as GitChange[],
      untrackedChanges: [] as GitChange[],
      mergeChanges: [] as GitChange[],
      onDidChange: event(),
    },
    ui: { selected: true, onDidChange: event() },
    diffIndexWithHEAD: async () => '',
    diffWithHEAD: async () => '',
    checkIgnore: async () => new Set<string>(),
    log: async () => [],
  };
  return { ...base, ...overrides } as unknown as GitRepository;
}

const reader: FileReader = {
  read: async (): Promise<FileReadResult> => ({ kind: 'content', data: Buffer.from('one\ntwo\n', 'utf8') }),
};

describe('VscodeGitRepository status mapping', () => {
  it('maps index statuses to core statuses and keeps only staged entries', () => {
    const adapter = new VscodeGitRepository(
      repository({
        state: {
          HEAD: { name: 'main', commit: 'abc' },
          indexChanges: [
            change('src/modified.ts', GIT_STATUS.INDEX_MODIFIED),
            change('src/added.ts', GIT_STATUS.INDEX_ADDED),
            change('src/deleted.ts', GIT_STATUS.INDEX_DELETED),
            change('src/renamed.ts', GIT_STATUS.INDEX_RENAMED, 'src/old-name.ts'),
            change('src/copied.ts', GIT_STATUS.INDEX_COPIED, 'src/source.ts'),
            change('src/ignored.ts', GIT_STATUS.IGNORED),
          ],
          workingTreeChanges: [],
          untrackedChanges: [],
          mergeChanges: [],
          onDidChange: event(),
        },
      }),
      reader,
    );

    const status = adapter.status();
    expect(status.staged.map((entry) => [entry.path, entry.status, entry.staged])).toEqual([
      ['src/modified.ts', 'modified', true],
      ['src/added.ts', 'added', true],
      ['src/deleted.ts', 'deleted', true],
      ['src/renamed.ts', 'renamed', true],
      ['src/copied.ts', 'copied', true],
    ]);
    expect(status.staged.some((entry) => entry.path === 'src/ignored.ts')).toBe(false);
  });

  it('maps working-tree, untracked and type-change entries', () => {
    const adapter = new VscodeGitRepository(
      repository({
        state: {
          HEAD: { name: 'main', commit: 'abc' },
          indexChanges: [],
          workingTreeChanges: [
            change('src/w.ts', GIT_STATUS.MODIFIED),
            change('src/d.ts', GIT_STATUS.DELETED),
            change('src/t.ts', GIT_STATUS.TYPE_CHANGED),
            change('src/ignored.ts', GIT_STATUS.IGNORED),
          ],
          untrackedChanges: [change('src/u.ts', GIT_STATUS.UNTRACKED)],
          mergeChanges: [],
          onDidChange: event(),
        },
      }),
      reader,
    );

    const status = adapter.status();
    expect(status.unstaged.map((entry) => entry.status)).toEqual(['modified', 'deleted', 'typechange']);
    expect(status.untracked.map((entry) => entry.status)).toEqual(['untracked']);
  });

  it('reports merge changes as conflicts', () => {
    const adapter = new VscodeGitRepository(
      repository({
        state: {
          HEAD: { name: 'main', commit: 'abc' },
          indexChanges: [],
          workingTreeChanges: [],
          untrackedChanges: [],
          mergeChanges: [change('src/conflict.ts', GIT_STATUS.MERGE_START)],
          onDidChange: event(),
        },
      }),
      reader,
    );
    expect(adapter.status().conflicted).toEqual([
      { path: 'src/conflict.ts', originalPath: undefined, status: 'conflicted', staged: false },
    ]);
  });

  it('uses renameUri (not originalUri) as the previous path', () => {
    const adapter = new VscodeGitRepository(
      repository({
        state: {
          HEAD: { name: 'main', commit: 'abc' },
          indexChanges: [change('src/new/name.ts', GIT_STATUS.INDEX_RENAMED, 'src/old/name.ts')],
          workingTreeChanges: [],
          untrackedChanges: [],
          mergeChanges: [],
          onDidChange: event(),
        },
      }),
      reader,
    );
    const [entry] = adapter.status().staged;
    expect(entry.originalPath).toBe('src/old/name.ts');
    expect(entry.path).toBe('src/new/name.ts');
  });

  it('normalizes platform separators to repository-relative POSIX paths', () => {
    const adapter = new VscodeGitRepository(
      repository({
        state: {
          HEAD: { name: 'main', commit: 'abc' },
          indexChanges: [change('src/deep/file.ts', GIT_STATUS.INDEX_ADDED)],
          workingTreeChanges: [],
          untrackedChanges: [],
          mergeChanges: [],
          onDidChange: event(),
        },
      }),
      reader,
    );
    expect(adapter.status().staged[0].path).toBe('src/deep/file.ts');
    expect(adapter.rootPath).toBe(ROOT);
    expect(adapter.repoName).toBe('repo');
  });
});

describe('VscodeGitRepository diffs', () => {
  it('routes staged and working diffs to the matching Git API methods', async () => {
    const calls: string[] = [];
    const adapter = new VscodeGitRepository(
      repository({
        diffIndexWithHEAD: async (target: string) => {
          calls.push(`staged:${target}`);
          return 'staged-diff';
        },
        diffWithHEAD: async (target: string) => {
          calls.push(`working:${target}`);
          return 'working-diff';
        },
      }),
      reader,
    );

    const staged = await adapter.diffStaged('src/a.ts', neverCancelled);
    const working = await adapter.diffWorking('src/a.ts', neverCancelled);

    expect(staged.ok && staged.value).toBe('staged-diff');
    expect(working.ok && working.value).toBe('working-diff');
    expect(calls).toEqual(['staged:src/a.ts', 'working:src/a.ts']);
  });

  it('retries with an absolute path when the relative path fails', async () => {
    const calls: string[] = [];
    const adapter = new VscodeGitRepository(
      repository({
        diffIndexWithHEAD: async (target: string) => {
          calls.push(target);
          if (calls.length === 1) {
            throw new Error('unknown path');
          }
          return 'ok';
        },
      }),
      reader,
    );

    const result = await adapter.diffStaged('src/a.ts', neverCancelled);
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain('src');
  });

  it('synthesizes an untracked file patch from the file reader', async () => {
    const adapter = new VscodeGitRepository(repository(), reader);
    const result = await adapter.diffUntracked('src/new.ts', 10000, neverCancelled);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.text).toContain('+++ b/src/new.ts');
      expect(result.value.text).toContain('+one');
      expect(result.value.binary).toBe(false);
    }
  });

  it('marks binary untracked files', async () => {
    const binaryReader: FileReader = {
      read: async () => ({ kind: 'content', data: Buffer.from([0, 1, 2, 3]) }),
    };
    const adapter = new VscodeGitRepository(repository(), binaryReader);
    const result = await adapter.diffUntracked('asset.bin', 10000, neverCancelled);
    expect(result.ok && result.value.binary).toBe(true);
  });

  it('omits untracked files that exceed the size limit', async () => {
    const largeReader: FileReader = { read: async () => ({ kind: 'too-large' }) };
    const adapter = new VscodeGitRepository(repository(), largeReader);
    const result = await adapter.diffUntracked('huge.json', 10, neverCancelled);
    expect(result.ok && result.value.tooLarge).toBe(true);
  });

  it('treats ignore-check failures as an empty ignore set', async () => {
    const adapter = new VscodeGitRepository(
      repository({
        checkIgnore: async () => {
          throw new Error('not a repo');
        },
      }),
      reader,
    );
    expect(await adapter.checkIgnore(['a'])).toEqual(new Set());
  });
});
