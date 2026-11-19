import { describe, expect, it } from 'vitest';
import { CancelToken, neverCancelled } from '../../../src/core/domain/cancel-signal.js';
import type { DiffPlan, PromptSegment } from '../../../src/core/domain/budget.js';
import { appError, type AppError } from '../../../src/core/domain/errors.js';
import { err, ok, type Result } from '../../../src/core/domain/result.js';
import { summarizeChanges } from '../../../src/core/summary/change-summarizer.js';
import { SummaryCache } from '../../../src/core/summary/summary-cache.js';
import type { SummaryModel, SummaryOptions } from '../../../src/core/summary/summary-types.js';

function segment(path: string, lines = 40): PromptSegment {
  return {
    path,
    status: 'modified',
    staged: true,
    insertions: lines,
    deletions: 0,
    lines: Array.from({ length: lines }, (_, index) => `+line ${index} of ${path}`),
    omittedLines: 0,
  };
}

function plan(segments: readonly PromptSegment[], omitted: DiffPlan['omitted'] = []): DiffPlan {
  return {
    strategy: 'map-reduce',
    segments,
    omitted,
    manifest: segments.map((entry) => entry.path),
    estimatedTokens: segments.length * 100,
    manifestTokens: 10,
    budgetTokens: 12000,
    chunkCount: segments.length,
  };
}

class FakeModel implements SummaryModel {
  readonly cacheKey = 'test:model';
  readonly calls: string[] = [];

  constructor(
    private readonly responder: (call: number) => Result<string, AppError> = () => ok('summary'),
  ) {}

  async summarize(request: { user: string }): Promise<Result<string, AppError>> {
    this.calls.push(request.user);
    return this.responder(this.calls.length);
  }
}

function options(overrides: Partial<SummaryOptions> = {}): SummaryOptions {
  return {
    system: 'summarize',
    maxTokens: 200,
    chunkTokens: 10000,
    maxAttempts: 2,
    ...overrides,
  };
}

describe('summarizeChanges', () => {
  it('summarizes and aggregates chunks', async () => {
    const model = new FakeModel(() => ok('- src/a.ts: added a guard'));
    const result = await summarizeChanges({
      plan: plan([segment('src/a.ts'), segment('src/b.ts')]),
      model,
      options: options(),
      signal: neverCancelled,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.chunks).toHaveLength(1);
    expect(result.value.texts).toEqual(['- src/a.ts: added a guard']);
    expect(result.value.coverage.analyzed).toBe(2);
    expect(result.value.coverage.failed).toBe(0);
    expect(result.value.consolidated).toContain('## src');
    expect(result.value.limitations).toEqual([]);
  });

  it('retries retryable chunk failures', async () => {
    const model = new FakeModel((call) =>
      call === 1 ? err(appError('rate_limit', 'slow down', { retryable: true })) : ok('recovered'),
    );
    const result = await summarizeChanges({
      plan: plan([segment('src/a.ts')]),
      model,
      options: options(),
      signal: neverCancelled,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.chunks[0].attempts).toBe(2);
      expect(result.value.chunks[0].text).toBe('recovered');
    }
    expect(model.calls).toHaveLength(2);
  });

  it('records partial failures without losing the rest', async () => {
    const model = new FakeModel((call) =>
      call === 1 ? err(appError('bad_request', 'rejected')) : ok('second chunk summary'),
    );
    const result = await summarizeChanges({
      plan: plan([segment('src/a.ts'), segment('src/b.ts')]),
      model,
      options: options({ chunkTokens: 300 }),
      signal: neverCancelled,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.chunks).toHaveLength(2);
    expect(result.value.chunks[0].error?.code).toBe('bad_request');
    expect(result.value.chunks[1].text).toBe('second chunk summary');
    expect(result.value.coverage.failed).toBe(1);
    expect(result.value.coverage.analyzed).toBe(1);
    expect(result.value.limitations.join(' ')).toContain('could not be summarized');
    expect(result.value.consolidated).toContain('[not analyzed');
  });

  it('reports important files that were not analyzed', async () => {
    const result = await summarizeChanges({
      plan: plan([segment('src/a.ts')], [{ path: 'src/important.ts', reason: 'budget' }]),
      model: new FakeModel(),
      options: options(),
      signal: neverCancelled,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const text = result.value.limitations.join(' ');
      expect(text).toContain('not analyzed');
      expect(text).toContain('src/important.ts');
      expect(result.value.coverage.omitted).toBe(1);
    }
  });

  it('stops on cancellation without calling the model', async () => {
    const token = new CancelToken();
    token.abort('user');
    const model = new FakeModel();
    const result = await summarizeChanges({
      plan: plan([segment('src/a.ts')]),
      model,
      options: options(),
      signal: token,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('cancelled');
    }
    expect(model.calls).toHaveLength(0);
  });

  it('reuses cached summaries for identical chunks', async () => {
    const cache = new SummaryCache({ now: () => 0 });
    const model = new FakeModel(() => ok('cached summary'));
    const input = {
      plan: plan([segment('src/a.ts')]),
      model,
      options: options({ cache }),
      signal: neverCancelled,
    };

    const first = await summarizeChanges(input);
    const second = await summarizeChanges(input);

    expect(first.ok && second.ok).toBe(true);
    expect(model.calls).toHaveLength(1);
    if (second.ok) {
      expect(second.value.chunks[0].cached).toBe(true);
    }
  });

  it('reports an empty plan instead of silently succeeding', async () => {
    const result = await summarizeChanges({
      plan: plan([]),
      model: new FakeModel(),
      options: options(),
      signal: neverCancelled,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.limitations.join(' ')).toContain('No analyzable changes');
    }
  });

  it('reports progress for every chunk', async () => {
    const events: Array<{ phase: string; completed: number; total: number }> = [];
    await summarizeChanges({
      plan: plan([segment('src/a.ts'), segment('src/b.ts')]),
      model: new FakeModel(),
      options: options({ chunkTokens: 300, onProgress: (event) => events.push(event) }),
      signal: neverCancelled,
    });

    expect(events.filter((event) => event.phase === 'summarizing').length).toBeGreaterThanOrEqual(2);
    expect(events[events.length - 1]?.phase).toBe('aggregating');
    expect(events[events.length - 1]?.completed).toBe(2);
  });
});
