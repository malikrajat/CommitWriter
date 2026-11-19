import { describe, expect, it } from 'vitest';
import { neverCancelled } from '../../src/core/domain/cancel-signal.js';
import type { DiffPlan, PromptSegment } from '../../src/core/domain/budget.js';
import type { ChangeStatus } from '../../src/core/domain/diff-hunk.js';
import type { FileChange } from '../../src/core/domain/file-change.js';
import { ok } from '../../src/core/domain/result.js';
import { buildPlan } from '../../src/core/context/token-budgeter.js';
import { buildChangeBrief } from '../../src/core/message/change-brief.js';
import { summarizeChanges } from '../../src/core/summary/change-summarizer.js';
import type { SummaryModel } from '../../src/core/summary/summary-types.js';
import type { GitAPI, GitRepository } from '../../src/git/git-types.js';
import { RepositoryResolver } from '../../src/git/repository-resolver.js';
import { setActiveTextEditor } from '../support/vscode-stub.js';
import type { Uri } from 'vscode';

function file(
  path: string,
  options: {
    status?: ChangeStatus;
    lines?: number;
    binary?: boolean;
  } = {},
): FileChange {
  const lines = options.lines ?? 8;
  const hunks =
    options.binary || lines === 0
      ? []
      : [
          {
            header: `@@ -0,0 +1,${lines} @@`,
            oldStart: 0,
            oldLines: 0,
            newStart: 1,
            newLines: lines,
            lines: Array.from({ length: lines }, (_, index) => `+line ${index} of ${path}`),
          },
        ];
  return {
    path,
    status: options.status ?? 'modified',
    staged: true,
    insertions: lines,
    deletions: 0,
    isBinary: options.binary ?? false,
    hunks,
    omittedLines: 0,
    sensitivity: 'none',
  };
}

const model: SummaryModel = {
  cacheKey: 'audit:model',
  summarize: async () => ok('- summarized'),
};

function planFor(files: readonly FileChange[], maxDiffTokens = 12000): DiffPlan {
  return buildPlan({
    files,
    omitted: [],
    budget: { maxDiffTokens, maxFiles: 200, maxFileDiffLines: 400, allowMapReduce: true },
    overheadTokens: 400,
  });
}

function summaryFor(plan: DiffPlan) {
  return summarizeChanges({
    plan,
    model,
    options: { system: 'summarize', maxTokens: 200, chunkTokens: 2000, maxAttempts: 1 },
    signal: neverCancelled,
  });
}

describe('audit: change-set scenarios', () => {
  it('1. handles one changed file', async () => {
    const plan = planFor([file('src/a.ts')]);
    expect(plan.segments).toHaveLength(1);
    expect(plan.omitted).toHaveLength(0);
    const summary = await summaryFor(plan);
    expect(summary.ok).toBe(true);
    if (summary.ok) {
      expect(summary.value.coverage.analyzed).toBe(1);
      expect(summary.value.limitations).toEqual([]);
    }
  });

  it('2. handles multiple changed files across groups', async () => {
    const files = [
      file('src/a.ts'),
      file('src/b.ts'),
      file('packages/api/server.ts'),
      file('packages/web/app.tsx'),
      file('docs/guide.md'),
      file('package.json'),
    ];
    const plan = planFor(files);
    const brief = buildChangeBrief(files);
    expect(plan.segments).toHaveLength(6);
    expect(brief.secondary.length).toBeGreaterThan(0);
    const summary = await summaryFor(plan);
    expect(summary.ok && summary.value.groups.length).toBeGreaterThan(1);
  });

  it('3. handles 200 changed files', async () => {
    const files = Array.from({ length: 200 }, (_, index) => file(`src/mod${index % 20}/file${index}.ts`));
    const plan = planFor(files);
    expect(plan.segments.length).toBeGreaterThan(0);
    expect(plan.segments.length + plan.omitted.length).toBe(200);
    const summary = await summaryFor(plan);
    expect(summary.ok).toBe(true);
    if (summary.ok) {
      expect(summary.value.coverage.files).toBe(200);
      expect(summary.value.coverage.analyzed).toBeGreaterThan(0);
    }
  });

  it('4. handles 1200 changed files without losing track of any', async () => {
    const files = Array.from({ length: 1200 }, (_, index) => file(`packages/p${index % 40}/src/file${index}.ts`));
    const started = Date.now();
    const plan = planFor(files);
    const summary = await summaryFor(plan);
    const elapsed = Date.now() - started;

    expect(plan.segments.length + plan.omitted.length).toBe(1200);
    expect(summary.ok).toBe(true);
    if (summary.ok) {
      expect(summary.value.coverage.files).toBe(1200);
      expect(summary.value.coverage.omitted).toBeGreaterThan(0);
      expect(summary.value.limitations.length).toBeGreaterThan(0);
    }
    expect(elapsed).toBeLessThan(10000);
  });

  it('5. truncates a very large individual file explicitly', () => {
    const plan = planFor([file('src/huge.ts', { lines: 20000 })]);
    expect(plan.segments).toHaveLength(1);
    expect(plan.segments[0].omittedLines).toBeGreaterThan(0);
    expect(plan.segments[0].lines.join('\n')).toContain('lines omitted');
  });

  it('6. classifies binary files without sending hunks', () => {
    const binary = file('media/logo.png', { binary: true, lines: 0 });
    const plan = planFor([binary]);
    const brief = buildChangeBrief([binary]);
    expect(brief.categories['binary']).toBe(1);
    expect(plan.segments[0].lines).toHaveLength(0);
    expect(binary.isBinary).toBe(true);
  });

  it('7. tracks deleted files', () => {
    const deleted = file('src/removed.ts', { status: 'deleted', lines: 3 });
    const brief = buildChangeBrief([deleted]);
    expect(brief.counts.deleted).toBe(1);
    expect(brief.counts.added).toBe(0);
  });

  it('8. tracks renamed files', () => {
    const renamed: FileChange = { ...file('src/new-name.ts', { lines: 0 }), status: 'renamed', oldPath: 'src/old-name.ts' };
    const brief = buildChangeBrief([renamed]);
    expect(brief.counts.renamed).toBe(1);
    expect(brief.paths).toContain('src/new-name.ts');
  });

  it('9. handles a file with an empty diff', async () => {
    const plan = planFor([file('src/mode-only.ts', { lines: 0 })]);
    expect(plan.segments).toHaveLength(1);
    expect(plan.segments[0].lines).toHaveLength(0);
    const summary = await summaryFor(plan);
    expect(summary.ok).toBe(true);
  });

  it('15/17. resolves multiple repositories and reports none', () => {
    const root = (path: string): Uri => ({ fsPath: path }) as unknown as Uri;
    const repo = (path: string, selected = false): GitRepository =>
      ({
        rootUri: root(path),
        kind: 'repository',
        ui: { selected, onDidChange: () => ({ dispose: () => undefined }) },
      }) as unknown as GitRepository;

    const api = (repositories: GitRepository[]): GitAPI =>
      ({
        repositories,
        getRepository: (target: Uri) =>
          repositories.find((entry) => target.fsPath.startsWith(entry.rootUri.fsPath)) ?? null,
      }) as unknown as GitAPI;

    const a = repo('C:\\work\\a');
    const b = repo('C:\\work\\b', true);
    setActiveTextEditor({ document: { uri: root('C:\\work\\a\\src\\file.ts') } });
    expect(new RepositoryResolver(api([a, b])).resolve()).toBe(a);

    setActiveTextEditor(undefined);
    expect(new RepositoryResolver(api([a, b])).resolve()).toBe(b);

    const empty = new RepositoryResolver(api([]));
    expect(empty.resolve()).toBeUndefined();
    expect(empty.choices()).toEqual([]);
  });
});
