import { describe, expect, it } from 'vitest';
import { composeMessage } from '../../../src/core/message/message-composer.js';
import { parseMessage, splitSubject } from '../../../src/core/message/output-parser.js';
import { validateConventional } from '../../../src/core/message/conventional-validator.js';

const settings = {
  enabled: true,
  types: ['feat', 'fix', 'refactor', 'chore', 'docs'],
  maxSubjectLength: 72,
  requireScope: false,
  allowedScopes: [],
};

const provenance = {
  providerId: 'openai',
  model: 'gpt',
  strategy: 'single-pass' as const,
  mode: 'smart' as const,
};

describe('parseMessage', () => {
  it('extracts subject, body and footers', () => {
    const parsed = parseMessage(
      'feat(git): collect staged diffs\n\nUse the index state.\n\nBREAKING CHANGE: collector returns ChangeSet',
    );
    expect(parsed.subject).toBe('feat(git): collect staged diffs');
    expect(parsed.body).toBe('Use the index state.');
    expect(parsed.footers).toEqual(['BREAKING CHANGE: collector returns ChangeSet']);
  });

  it('skips preambles and code fences', () => {
    const parsed = parseMessage('Here is your commit message:\n```\nfix: handle empty diff\n```');
    expect(parsed.subject).toBe('fix: handle empty diff');
  });

  it('splits conventional parts', () => {
    expect(splitSubject('feat(api)!: drop v1 endpoint')).toEqual({
      type: 'feat',
      scope: 'api',
      breaking: true,
      description: 'drop v1 endpoint',
    });
  });
});

describe('validateConventional', () => {
  it('accepts a conforming subject', () => {
    const result = validateConventional({ subject: 'feat(git): add staged diff collection', footers: [], settings });
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(result.conventional?.scope).toBe('git');
  });

  it('warns on unknown types', () => {
    const result = validateConventional({ subject: 'feature: add thing', footers: [], settings });
    expect(result.valid).toBe(false);
    expect(result.warnings[0]).toContain('not in the configured type list');
  });

  it('shortens an over-long subject at a word boundary', () => {
    const long = `feat: ${'word '.repeat(30)}end`;
    const result = validateConventional({ subject: long, footers: [], settings });
    expect(result.subject.length).toBeLessThanOrEqual(72);
    expect(result.subject.endsWith('word')).toBe(true);
  });

  it('removes a trailing period', () => {
    const result = validateConventional({ subject: 'fix: handle empty diff.', footers: [], settings });
    expect(result.subject).toBe('fix: handle empty diff');
  });

  it('flags breaking-change inconsistency', () => {
    const result = validateConventional({ subject: 'feat!: drop v1', footers: [], settings });
    expect(result.warnings.some((warning) => warning.includes('BREAKING CHANGE'))).toBe(true);
  });

  it('enforces required scopes', () => {
    const result = validateConventional({
      subject: 'feat: scoped',
      footers: [],
      settings: { ...settings, requireScope: true },
    });
    expect(result.valid).toBe(false);
  });
});

describe('composeMessage', () => {
  it('repairs fenced output with a trailing period', () => {
    const message = composeMessage({
      raw: '```\nfeat: add thing.\n```',
      settings,
      includeBody: true,
      maxSubjectLength: 72,
      provenance,
    });
    expect(message.subject).toBe('feat: add thing');
    expect(message.warnings.some((warning) => warning.includes('repaired'))).toBe(true);
  });

  it('drops the body when the mode forbids it', () => {
    const message = composeMessage({
      raw: 'fix: a\n\nbody text',
      settings,
      includeBody: false,
      maxSubjectLength: 72,
      provenance,
    });
    expect(message.body).toBeUndefined();
    expect(message.raw).toBe('fix: a');
  });

  it('reports an unusable message instead of inventing content', () => {
    const message = composeMessage({
      raw: '   ',
      settings,
      includeBody: true,
      maxSubjectLength: 72,
      provenance,
    });
    expect(message.subject).toBe('');
    expect(message.warnings.some((warning) => warning.includes('no usable'))).toBe(true);
  });

  it('caps an overly long body and warns', () => {
    const body = Array.from({ length: 40 }, (_, index) => `- line ${index}`).join('\n');
    const message = composeMessage({
      raw: `feat: thing\n\n${body}`,
      settings,
      includeBody: true,
      maxSubjectLength: 72,
      provenance,
    });
    expect(message.body?.split('\n')).toHaveLength(20);
    expect(message.warnings.some((warning) => warning.includes('truncated to 20 lines'))).toBe(true);
  });
});
