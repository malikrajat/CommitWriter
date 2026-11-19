import { describe, expect, it } from 'vitest';
import { neverCancelled } from '../../../src/core/domain/cancel-signal.js';
import type {
  CollectorOptions,
  GitChangeEntry,
  GitRepositoryPort,
  GitStatusSnapshot,
  UntrackedDiff,
} from '../../../src/core/ports/i-git.js';
import { nullLogger } from '../../../src/core/ports/i-logger.js';
import { ok } from '../../../src/core/domain/result.js';
import { VscodeDiffCollector } from '../../../src/git/diff-collector.js';

function entry(path: string, staged: boolean, status: GitChangeEntry['status'] = 'modified'): GitChangeEntry {
  return { path, status, staged };
}

function diff(path: string, lines: number): string {
  const body = Array.from({ length: lines }, (_, index) => `+line ${index} of ${path}`).join('\n');
  return [
    `diff --git a/${path} b/${path}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${path}`,
    `@@ -0,0 +1,${lines} @@`,
    body,
  ].join('\n');
}

class FakePort implements GitRepositoryPort {
  readonly rootPath = 'C:\\work\\repo';
  readonly repoName = 'repo';
  readonly head = 'abc';
  readonly branch = 'main';
  readonly isVirtualFileSystem = false;

  constructor(
    private readonly snapshot: GitStatusSnapshot,
    private readonly texts: Record<string, string> = {},
    private readonly untracked: Record<string, UntrackedDiff> = {},
  ) {}

  status(): GitStatusSnapshot {
    return this.snapshot;
  }

  async diffStaged(path: string) {
    return ok(this.texts[`staged:${path}`] ?? '');
  }

  async diffWorking(path: string) {
    return ok(this.texts[`working:${path}`] ?? '');
  }

  async diffUntracked(path: string) {
    return ok(this.untracked[path] ?? { text: '', binary: false, tooLarge: false });
  }

  async shortStats() {
    return ok({ files: 1, insertions: 0, deletions: 0 });
  }

  async checkIgnore() {
    return new Set<string>();
  }
}

function options(overrides: Partial<CollectorOptions> = {}): CollectorOptions {
  return {
    selection: {
      includeStaged: true,
      includeUnstaged: false,
      includeUntracked: false,
    },
    maxFiles: 100,
    maxFileBytes: 100000,
    excludeGlobs: [],
    allowSensitive: false,
    ...overrides,
  };
}

function snapshot(overrides: Partial<GitStatusSnapshot> = {}): GitStatusSnapshot {
  return { staged: [], unstaged: [], untracked: [], conflicted: [], ...overrides };
}

describe('VscodeDiffCollector', () => {
  it('collects staged files and parses their diffs', async () => {
    const port = new FakePort(
      snapshot({ staged: [entry('src/a.ts', true), entry('src/b.ts', true, 'added')] }),
      { 'staged:src/a.ts': diff('src/a.ts', 3), 'staged:src/b.ts': diff('src/b.ts', 2) },
    );

    const result = await new VscodeDiffCollector(port, nullLogger).collect(options(), neverCancelled);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.files.map((file) => file.path)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(result.value.files[0].insertions).toBe(3);
    expect(result.value.files[0].staged).toBe(true);
    expect(result.value.counts.files).toBe(2);
    expect(result.value.counts.insertions).toBe(5);
  });

  it('ignores working-tree and untracked files in the default staged scope', async () => {
    const port = new FakePort(
      snapshot({
        staged: [entry('src/a.ts', true)],
        unstaged: [entry('src/w.ts', false)],
        untracked: [entry('src/new.ts', false, 'untracked')],
      }),
      { 'staged:src/a.ts': diff('src/a.ts', 1) },
    );

    const result = await new VscodeDiffCollector(port, nullLogger).collect(options(), neverCancelled);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.files.map((file) => file.path)).toEqual(['src/a.ts']);
    }
  });

  it('includes untracked files when the scope allows them', async () => {
    const port = new FakePort(
      snapshot({
        staged: [entry('src/a.ts', true)],
        untracked: [entry('src/new.ts', false, 'untracked')],
      }),
      { 'staged:src/a.ts': diff('src/a.ts', 1) },
      { 'src/new.ts': { text: diff('src/new.ts', 2), binary: false, tooLarge: false } },
    );

    const result = await new VscodeDiffCollector(port, nullLogger).collect(
      options({
        selection: { includeStaged: true, includeUnstaged: false, includeUntracked: true },
      }),
      neverCancelled,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const untracked = result.value.files.find((file) => file.path === 'src/new.ts');
      expect(untracked?.status).toBe('untracked');
      expect(untracked?.insertions).toBe(2);
      expect(result.value.counts.untracked).toBe(1);
    }
  });

  it('omits generated and excluded files with a reason', async () => {
    const port = new FakePort(
      snapshot({
        staged: [entry('package-lock.json', true), entry('src/a.ts', true)],
      }),
      { 'staged:src/a.ts': diff('src/a.ts', 1) },
    );

    const result = await new VscodeDiffCollector(port, nullLogger).collect(options(), neverCancelled);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.files.map((file) => file.path)).toEqual(['src/a.ts']);
      expect(result.value.omitted).toEqual([
        expect.objectContaining({ path: 'package-lock.json', reason: 'generated' }),
      ]);
    }
  });

  it('applies custom exclusion globs', async () => {
    const port = new FakePort(snapshot({ staged: [entry('specs/a.spec.ts', true)] }));
    const result = await new VscodeDiffCollector(port, nullLogger).collect(
      options({ excludeGlobs: ['**/*.spec.ts'] }),
      neverCancelled,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.files).toHaveLength(0);
      expect(result.value.omitted[0].reason).toBe('generated');
    }
  });

  it('blocks sensitive files unless explicitly allowed', async () => {
    const port = new FakePort(snapshot({ staged: [entry('.env', true)] }), { 'staged:.env': diff('.env', 1) });

    const blocked = await new VscodeDiffCollector(port, nullLogger).collect(options(), neverCancelled);
    expect(blocked.ok).toBe(true);
    if (blocked.ok) {
      expect(blocked.value.files).toHaveLength(0);
      expect(blocked.value.omitted[0].reason).toBe('sensitive');
    }

    const allowed = await new VscodeDiffCollector(port, nullLogger).collect(
      options({ allowSensitive: true }),
      neverCancelled,
    );
    expect(allowed.ok).toBe(true);
    if (allowed.ok) {
      expect(allowed.value.files.map((file) => file.path)).toEqual(['.env']);
    }
  });

  it('omits untracked files that are too large', async () => {
    const port = new FakePort(
      snapshot({ untracked: [entry('huge.json', false, 'untracked')] }),
      {},
      { 'huge.json': { text: '', binary: false, tooLarge: true } },
    );
    const result = await new VscodeDiffCollector(port, nullLogger).collect(
      options({ selection: { includeStaged: false, includeUnstaged: true, includeUntracked: true } }),
      neverCancelled,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.files).toHaveLength(0);
      expect(result.value.omitted[0].reason).toBe('too-large');
    }
  });

  it('caps collection at twice the configured file limit', async () => {
    const port = new FakePort(
      snapshot({
        staged: [entry('a.ts', true), entry('b.ts', true), entry('c.ts', true)],
      }),
      { 'staged:a.ts': diff('a.ts', 1), 'staged:b.ts': diff('b.ts', 1), 'staged:c.ts': diff('c.ts', 1) },
    );

    const result = await new VscodeDiffCollector(port, nullLogger).collect(
      options({ maxFiles: 1 }),
      neverCancelled,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.files).toHaveLength(2);
      expect(result.value.omitted).toEqual([expect.objectContaining({ path: 'c.ts', reason: 'max-files' })]);
    }
  });
});
