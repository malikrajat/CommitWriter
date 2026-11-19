import type { ChangeStatus } from '../domain/diff-hunk.js';
import type { FileChange } from '../domain/file-change.js';

const STATUS_WEIGHT: Readonly<Record<ChangeStatus, number>> = {
  conflicted: 8,
  added: 6,
  untracked: 6,
  modified: 5,
  renamed: 4,
  copied: 3,
  deleted: 3,
  typechange: 1,
};

const SOURCE_HINT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|kts|cs|cpp|cc|c|h|hpp|rb|php|swift|scala|sh|ps1|sql|vue|svelte|astro|lua|dart|ex|exs|erl|clj|hs|ml|nim|zig)$/i;
const TEST_HINT = /(^|\/)(test|tests|__tests__|spec|e2e)\/|\.(test|spec)\.[a-z]+$/i;
const DOC_HINT = /\.(md|mdx|txt|rst|adoc)$/i;

function depth(path: string): number {
  return path.split('/').length;
}

/**
 * Deterministic relevance score. Higher is more likely to carry the intent of
 * the change. Ties break on path so the plan is byte-identical across runs.
 */
export function scoreFile(file: FileChange): number {
  let score = STATUS_WEIGHT[file.status] * 10;
  score += Math.min(file.insertions + file.deletions, 300) / 15;
  score -= depth(file.path) * 1.5;

  if (SOURCE_HINT.test(file.path)) {
    score += 8;
  }
  if (TEST_HINT.test(file.path)) {
    score -= 6;
  }
  if (DOC_HINT.test(file.path)) {
    score -= 3;
  }
  if (file.path.startsWith('.github/') || file.path.startsWith('.vscode/')) {
    score -= 4;
  }
  return score;
}

export function rankFiles(files: readonly FileChange[]): readonly FileChange[] {
  return [...files].sort((a, b) => {
    const delta = scoreFile(b) - scoreFile(a);
    if (delta !== 0) {
      return delta;
    }
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
}
