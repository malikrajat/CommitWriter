import { describe, expect, it } from 'vitest';
import { matchesGlob, matchesAny } from '../../../src/core/context/exclusion-policy.js';

describe('glob matching', () => {
  it('matches lockfiles at any depth', () => {
    expect(matchesGlob('package-lock.json', '**/package-lock.json')).toBe(true);
    expect(matchesGlob('apps/web/package-lock.json', '**/package-lock.json')).toBe(true);
  });

  it('matches a bare directory pattern anywhere', () => {
    expect(matchesGlob('dist/index.js', 'dist/**')).toBe(true);
    expect(matchesGlob('packages/a/dist/index.js', 'dist/**')).toBe(true);
  });

  it('does not cross path separators with a single star', () => {
    expect(matchesGlob('src/deep/a.ts', '*.ts')).toBe(false);
    expect(matchesGlob('a.ts', '*.ts')).toBe(true);
  });

  it('supports question marks', () => {
    expect(matchesGlob('a1.ts', 'a?.ts')).toBe(true);
    expect(matchesGlob('a12.ts', 'a?.ts')).toBe(false);
  });

  it('returns the matching pattern', () => {
    expect(matchesAny('src/a.min.js', ['**/*.min.js', '**/*.map'])).toBe('**/*.min.js');
    expect(matchesAny('src/a.ts', ['**/*.min.js'])).toBeUndefined();
  });
});
