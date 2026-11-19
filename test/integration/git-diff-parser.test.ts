import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from '../../src/core/context/diff-normalizer.js';

const git = spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;

let dir = '';

function run(args: string[]): string {
  const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  return `${result.stdout ?? ''}`;
}

describe.skipIf(!git)('real git diff output', () => {
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'commitwriter-it-'));
    run(['init', '-q']);
    run(['config', 'user.name', 'CommitWriter Test']);
    run(['config', 'user.email', 'test@commitwriter.local']);
    await fs.writeFile(path.join(dir, 'a.txt'), 'alpha\nbeta\ngamma\n', 'utf8');
    await fs.writeFile(path.join(dir, 'keep.txt'), 'keep\n', 'utf8');
    run(['add', '.']);
    run(['commit', '-q', '-m', 'init']);
  });

  afterAll(async () => {
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('parses an unstaged modification', async () => {
    await fs.writeFile(path.join(dir, 'a.txt'), 'alpha\nBETA\ngamma\ndelta\n', 'utf8');
    const parsed = parseUnifiedDiff(run(['diff', '--', 'a.txt']));
    expect(parsed.hunks).toHaveLength(1);
    expect(parsed.insertions).toBe(2);
    expect(parsed.deletions).toBe(1);
    expect(parsed.isBinary).toBe(false);
  });

  it('parses a staged modification', () => {
    run(['add', 'a.txt']);
    const parsed = parseUnifiedDiff(run(['diff', '--cached', '--', 'a.txt']));
    expect(parsed.hunks.length).toBeGreaterThanOrEqual(1);
    expect(parsed.insertions).toBe(2);
  });

  it('parses the --no-index patch used for untracked files', async () => {
    await fs.writeFile(path.join(dir, 'b.txt'), 'brand new\nsecond line\n', 'utf8');
    const parsed = parseUnifiedDiff(run(['diff', '--no-index', '--', '/dev/null', 'b.txt']));
    expect(parsed.hunks).toHaveLength(1);
    expect(parsed.insertions).toBe(2);
    expect(parsed.deletions).toBe(0);
  });

  it('detects binary diffs', async () => {
    await fs.writeFile(path.join(dir, 'blob.bin'), Buffer.from([0, 1, 2, 3, 0, 255, 10, 0]));
    run(['add', 'blob.bin']);
    const parsed = parseUnifiedDiff(run(['diff', '--cached', '--', 'blob.bin']));
    expect(parsed.isBinary).toBe(true);
  });

  it('handles a rename without producing spurious hunks', () => {
    run(['mv', 'keep.txt', 'renamed.txt']);
    const parsed = parseUnifiedDiff(run(['diff', '--cached', '-M', '--', 'keep.txt', 'renamed.txt']));
    expect(parsed.isBinary).toBe(false);
    expect(parsed.insertions).toBe(0);
    expect(parsed.deletions).toBe(0);
  });
});

describe.skipIf(git)('real git diff output (skipped)', () => {
  it('requires git on PATH', () => {
    expect(git).toBe(false);
  });
});

