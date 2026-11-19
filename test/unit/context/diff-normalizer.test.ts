import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from '../../../src/core/context/diff-normalizer.js';

const SAMPLE = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,3 +1,4 @@',
  ' const a = 1;',
  '-const b = 2;',
  '+const b = 3;',
  '+const c = 4;',
  ' export { a };',
].join('\n');

describe('parseUnifiedDiff', () => {
  it('parses hunks and counts additions/deletions', () => {
    const parsed = parseUnifiedDiff(SAMPLE);
    expect(parsed.hunks).toHaveLength(1);
    expect(parsed.hunks[0].lines).toHaveLength(5);
    expect(parsed.insertions).toBe(2);
    expect(parsed.deletions).toBe(1);
    expect(parsed.isBinary).toBe(false);
  });

  it('handles multiple hunks', () => {
    const parsed = parseUnifiedDiff(`${SAMPLE}\n@@ -10,1 +11,1 @@\n-old\n+new\n`);
    expect(parsed.hunks).toHaveLength(2);
  });

  it('detects binary patches', () => {
    const parsed = parseUnifiedDiff('diff --git a/x.png b/x.png\nBinary files a/x.png and b/x.png differ');
    expect(parsed.isBinary).toBe(true);
    expect(parsed.hunks).toHaveLength(0);
  });

  it('returns an empty result for empty input', () => {
    expect(parseUnifiedDiff('')).toEqual({ hunks: [], insertions: 0, deletions: 0, isBinary: false });
  });

  it('tolerates CRLF and "no newline" markers', () => {
    const parsed = parseUnifiedDiff('@@ -1 +1 @@\r\n-a\r\n+b\r\n\\ No newline at end of file\r\n');
    expect(parsed.hunks[0].lines).toEqual(['-a', '+b']);
  });
});
