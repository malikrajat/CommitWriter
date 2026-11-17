import { describe, expect, it } from 'vitest';
import { progressIncrement, summaryProgressMessage } from '../../../src/ui/progress.js';

describe('summaryProgressMessage', () => {
  it('describes chunk progress', () => {
    expect(
      summaryProgressMessage({ phase: 'summarizing', completed: 2, total: 5, label: 'packages/api' }),
    ).toBe('Summarizing 2/5 - packages/api');
  });

  it('describes the aggregation phase', () => {
    expect(summaryProgressMessage({ phase: 'aggregating', completed: 5, total: 5, label: 'x' })).toBe(
      'Aggregating summaries...',
    );
  });
});

describe('progressIncrement', () => {
  it('returns the percentage of newly completed work', () => {
    expect(progressIncrement(0, 1, 4)).toBe(25);
    expect(progressIncrement(1, 2, 4)).toBe(25);
  });

  it('returns zero when nothing new completed', () => {
    expect(progressIncrement(2, 2, 4)).toBe(0);
    expect(progressIncrement(3, 2, 4)).toBe(0);
  });

  it('handles a zero total', () => {
    expect(progressIncrement(0, 0, 0)).toBe(0);
  });

  it('never exceeds one hundred', () => {
    expect(progressIncrement(0, 10, 4)).toBe(100);
  });
});
