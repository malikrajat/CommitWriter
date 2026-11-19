import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { neverCancelled, type CancelSignal } from '../../src/core/domain/cancel-signal.js';
import type { ChangeStatus } from '../../src/core/domain/diff-hunk.js';
import { ok } from '../../src/core/domain/result.js';
import type {
  CollectorOptions,
  GitChangeEntry,
  GitRepositoryPort,
  GitStatusSnapshot,
} from '../../src/core/ports/i-git.js';
import { nullLogger } from '../../src/core/ports/i-logger.js';
import { VscodeDiffCollector } from '../../src/git/diff-collector.js';
import type { FileReadResult, FileReader } from '../../src/git/file-reader.js';
import { readUntrackedDiff } from '../../src/git/untracked-diff.js';

const gitAvailable = spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;

let dir = '';

function run(args: string[]): string {
  const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout ?? '';
}

function mapCode(code: string): ChangeStatus {
  switch (code) {
    case 'A':
      return 'added';
    case 'M':
      return 'modified';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    case 'T':
      return 'typechange';
    default:
      return 'modified';
  }
}

function statusSnapshot(): GitStatusSnapshot {
  const tokens = run(['status', '--porcelain=v1', '-z']).split('\0');
  const staged: GitChangeEntry[] = [];
  const unstaged: GitChangeEntry[] = [];
  const untracked: GitChangeEntry[] = [];
  const conflicted: GitChangeEntry[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) {
      continue;
    }
    const x = token[0] ?? ' ';
    const y = token[1] ?? ' ';
    const entryPath = token.slice(3);

    if (x === '?' && y === '?') {
      untracked.push({ path: entryPath, status: 'untracked', staged: false });
      continue;
    }
    if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) {
      conflicted.push({ path: entryPath, status: 'conflicted', staged: false });
      continue;
    }

    let originalPath: string | undefined;
    if (x === 'R' || x === 'C') {
      index += 1;
      originalPath = tokens[index];
    }
    if (x !== ' ') {
      staged.push({ path: entryPath, status: mapCode(x), staged: true, originalPath });
    }
    if (y !== ' ') {
      unstaged.push({ path: entryPath, status: mapCode(y), staged: false });
    }
  }

  return { staged, unstaged, untracked, conflicted };
}

const nodeReader: FileReader = {
  async read(absolutePath: string, maxBytes: number): Promise<FileReadResult> {
    try {
      const stat = await fs.stat(absolutePath);
      if (stat.size > maxBytes) {
        return { kind: 'too-large' };
      }
      return { kind: 'content', data: await fs.readFile(absolutePath) };
    } catch {
      return { kind: 'unreadable' };
    }
  },
};

class CliBackedRepository implements GitRepositoryPort {
  get rootPath(): string {
    return dir;
  }

  readonly repoName = 'fixture';
  readonly head = 'HEAD';
  readonly branch = 'main';
  readonly isVirtualFileSystem = false;

  status(): GitStatusSnapshot {
    return statusSnapshot();
  }

  async diffStaged(relativePath: string) {
    return ok(run(['diff', '--cached', '--', relativePath]));
  }

  async diffWorking(relativePath: string) {
    return ok(run(['diff', '--', relativePath]));
  }

  async diffUntracked(relativePath: string, maxBytes: number, signal: CancelSignal) {
    return readUntrackedDiff({
      reader: nodeReader,
      relativePath,
      absolutePath: path.join(dir, relativePath),
      maxBytes,
      signal,
    });
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
    selection: { includeStaged: true, includeUnstaged: false, includeUntracked: false },
    maxFiles: 100,
    maxFileBytes: 500000,
    excludeGlobs: [],
    allowSensitive: false,
    ...overrides,
  };
}

describe.skipIf(!gitAvailable)('Git integration against a real repository', () => {
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'commitwriter-git-'));
    run(['init', '-q']);
    run(['config', 'user.name', 'CommitWriter Test']);
    run(['config', 'user.email', 'test@commitwriter.local']);

    await fs.writeFile(path.join(dir, 'a.txt'), 'a\nb\nc\n', 'utf8');
    await fs.writeFile(path.join(dir, 'del.txt'), 'delete me\n', 'utf8');
    await fs.writeFile(path.join(dir, 'old.txt'), 'old name\n', 'utf8');
    await fs.writeFile(path.join(dir, 'keep.txt'), 'keep\n', 'utf8');
    run(['add', '.']);
    run(['commit', '-q', '-m', 'init']);

    await fs.writeFile(path.join(dir, 'a.txt'), 'a\nB\nc\nd\n', 'utf8');
    run(['add', 'a.txt']);
    run(['rm', '-q', 'del.txt']);
    run(['mv', 'old.txt', 'renamed.txt']);
    await fs.writeFile(path.join(dir, 'keep.txt'), 'keep changed\n', 'utf8');
    await fs.writeFile(path.join(dir, 'new.txt'), 'brand new file\n', 'utf8');
  });

  afterAll(async () => {
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('detects staged additions, modifications, deletions and renames', () => {
    const snapshot = statusSnapshot();
    const byPath = new Map(snapshot.staged.map((entry) => [entry.path, entry]));

    expect(byPath.get('a.txt')?.status).toBe('modified');
    expect(byPath.get('del.txt')?.status).toBe('deleted');
    expect(byPath.get('renamed.txt')?.status).toBe('renamed');
    expect(byPath.get('renamed.txt')?.originalPath).toBe('old.txt');
    expect(snapshot.untracked.map((entry) => entry.path)).toContain('new.txt');
    expect(snapshot.unstaged.map((entry) => entry.path)).toContain('keep.txt');
  });

  it('collects staged changes only by default', async () => {
    const result = await new VscodeDiffCollector(new CliBackedRepository(), nullLogger).collect(
      options(),
      neverCancelled,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const paths = result.value.files.map((file) => file.path);
    expect(paths).toEqual(['a.txt', 'del.txt', 'renamed.txt']);
    expect(paths).not.toContain('keep.txt');
    expect(paths).not.toContain('new.txt');
    expect(result.value.counts.staged).toBe(3);

    const modified = result.value.files.find((file) => file.path === 'a.txt');
    expect(modified?.insertions).toBe(2);
    expect(modified?.deletions).toBe(1);
    expect(modified?.hunks.length).toBeGreaterThanOrEqual(1);

    const deleted = result.value.files.find((file) => file.path === 'del.txt');
    expect(deleted?.deletions).toBe(1);

    const renamed = result.value.files.find((file) => file.path === 'renamed.txt');
    expect(renamed?.status).toBe('renamed');
    expect(renamed?.oldPath).toBe('old.txt');
  });

  it('includes unstaged and untracked changes when configured', async () => {
    const result = await new VscodeDiffCollector(new CliBackedRepository(), nullLogger).collect(
      options({ selection: { includeStaged: true, includeUnstaged: true, includeUntracked: true } }),
      neverCancelled,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const paths = result.value.files.map((file) => file.path);
    expect(paths).toEqual(['a.txt', 'del.txt', 'keep.txt', 'new.txt', 'renamed.txt']);

    const untracked = result.value.files.find((file) => file.path === 'new.txt');
    expect(untracked?.status).toBe('untracked');
    expect(untracked?.insertions).toBe(1);
    expect(untracked?.staged).toBe(false);

    const worktree = result.value.files.find((file) => file.path === 'keep.txt');
    expect(worktree?.staged).toBe(false);
    expect(result.value.counts.untracked).toBe(1);
  });

  it('reports no changes for a clean repository', async () => {
    run(['stash', 'push', '-u', '-q']);
    const result = await new VscodeDiffCollector(new CliBackedRepository(), nullLogger).collect(
      options({ selection: { includeStaged: true, includeUnstaged: true, includeUntracked: true } }),
      neverCancelled,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.files).toHaveLength(0);
    }
    run(['stash', 'pop', '-q']);
  });
});

describe.skipIf(gitAvailable)('Git integration (skipped)', () => {
  it('requires git on PATH', () => {
    expect(gitAvailable).toBe(false);
  });
});

