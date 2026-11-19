import { describe, expect, it } from 'vitest';
import { hashText, SummaryCache } from '../../../src/core/summary/summary-cache.js';

describe('hashText', () => {
  it('is deterministic and distinguishes content', () => {
    expect(hashText('abc')).toBe(hashText('abc'));
    expect(hashText('abc')).not.toBe(hashText('abd'));
  });
});

describe('SummaryCache', () => {
  it('stores and retrieves values', () => {
    const cache = new SummaryCache({ now: () => 1000 });
    cache.set('a', 'first');
    expect(cache.get('a')).toBe('first');
  });

  it('expires entries after the TTL', () => {
    let now = 0;
    const cache = new SummaryCache({ now: () => now }, 10, 100);
    cache.set('a', 'first');
    now = 150;
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('evicts the least recently used entry', () => {
    const cache = new SummaryCache({ now: () => 0 }, 2, 10000);
    cache.set('a', '1');
    cache.set('b', '2');
    cache.get('a');
    cache.set('c', '3');
    expect(cache.get('a')).toBe('1');
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe('3');
  });

  it('clears all entries', () => {
    const cache = new SummaryCache({ now: () => 0 });
    cache.set('a', '1');
    cache.clear();
    expect(cache.get('a')).toBeUndefined();
  });
});
