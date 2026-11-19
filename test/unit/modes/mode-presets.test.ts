import { describe, expect, it } from 'vitest';
import { MODE_PRESETS, resolveMode, resolveRequestTimeout } from '../../../src/core/modes/mode-presets.js';

const ceilings = { maxDiffTokens: 200000, contextWindow: 128000 };

describe('resolveMode', () => {
  it('exposes the three documented modes', () => {
    expect(MODE_PRESETS.quick.maxOutputTokens).toBeLessThan(MODE_PRESETS.smart.maxOutputTokens);
    expect(MODE_PRESETS.smart.maxOutputTokens).toBeLessThan(MODE_PRESETS.detailed.maxOutputTokens);
    expect(MODE_PRESETS.quick.includeBody).toBe(false);
    expect(MODE_PRESETS.quick.useMapReduce).toBe(false);
  });

  it('assigns a depth to each mode', () => {
    expect(MODE_PRESETS.quick.depth).toBe('single-pass');
    expect(MODE_PRESETS.smart.depth).toBe('adaptive');
    expect(MODE_PRESETS.detailed.depth).toBe('deep');
  });

  it('applies the global token ceiling', () => {
    const mode = resolveMode('detailed', undefined, { maxDiffTokens: 5000, contextWindow: 1000000 });
    expect(mode.maxDiffTokens).toBe(5000);
  });

  it('never exceeds half of the model context window', () => {
    const mode = resolveMode('detailed', undefined, { maxDiffTokens: 200000, contextWindow: 10000 });
    expect(mode.maxDiffTokens).toBe(5000);
  });

  it('clamps overrides that try to increase limits', () => {
    const mode = resolveMode('quick', { maxDiffTokens: 999999, maxOutputTokens: 999999, maxFiles: 9999 }, ceilings);
    expect(mode.maxDiffTokens).toBe(MODE_PRESETS.quick.maxDiffTokens);
    expect(mode.maxOutputTokens).toBe(MODE_PRESETS.quick.maxOutputTokens);
    expect(mode.maxFiles).toBe(MODE_PRESETS.quick.maxFiles);
  });

  it('accepts overrides that lower limits', () => {
    const mode = resolveMode('smart', { maxDiffTokens: 4000, includeBody: false, useMapReduce: false }, ceilings);
    expect(mode.maxDiffTokens).toBe(4000);
    expect(mode.includeBody).toBe(false);
    expect(mode.useMapReduce).toBe(false);
  });

  it('cannot turn the body back on in quick mode', () => {
    const mode = resolveMode('quick', { includeBody: true }, ceilings);
    expect(mode.includeBody).toBe(false);
  });
});

describe('resolveRequestTimeout', () => {
  it('uses the mode budget by default', () => {
    expect(resolveRequestTimeout(60000, 120000)).toBe(60000);
    expect(resolveRequestTimeout(120000, 120000)).toBe(120000);
  });

  it('lets a profile lower the timeout but never raise it', () => {
    expect(resolveRequestTimeout(120000, 120000, 30000)).toBe(30000);
    expect(resolveRequestTimeout(20000, 120000, 60000)).toBe(20000);
  });
});
