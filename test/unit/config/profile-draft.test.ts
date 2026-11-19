import { describe, expect, it } from 'vitest';
import {
  draftToProfile,
  parseHeadersJson,
  suggestProfileId,
  validateDraft,
  defaultDraft,
} from '../../../src/config/profile-draft.js';

describe('suggestProfileId', () => {
  it('uses the provider id when free', () => {
    expect(suggestProfileId('openai', [])).toBe('openai');
  });

  it('adds a suffix on collision', () => {
    expect(suggestProfileId('openai', ['openai'])).toBe('openai-2');
    expect(suggestProfileId('openai', ['openai', 'openai-2'])).toBe('openai-3');
  });
});

describe('defaultDraft', () => {
  it('fills provider defaults', () => {
    const draft = defaultDraft('anthropic', []);
    expect(draft.baseUrl).toBe('https://api.anthropic.com');
    expect(draft.dialect).toBe('anthropic-messages');
    expect(draft.model.length).toBeGreaterThan(0);
  });

  it('uses the native Ollama dialect', () => {
    expect(defaultDraft('ollama', []).dialect).toBe('ollama-native');
  });
});

describe('parseHeadersJson', () => {
  it('accepts an empty value', () => {
    expect(parseHeadersJson('')).toEqual({ ok: true, headers: {} });
  });

  it('parses string headers', () => {
    const result = parseHeadersJson('{"X-Org": "team", "X-Trace": "off"}');
    expect(result).toEqual({ ok: true, headers: { 'X-Org': 'team', 'X-Trace': 'off' } });
  });

  it('rejects invalid JSON', () => {
    const result = parseHeadersJson('{oops}');
    expect(result.ok).toBe(false);
  });

  it('rejects non-object JSON', () => {
    expect(parseHeadersJson('["a"]').ok).toBe(false);
    expect(parseHeadersJson('"text"').ok).toBe(false);
  });

  it('rejects non-string values', () => {
    const result = parseHeadersJson('{"X-Retries": 3}');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('string value');
    }
  });

  it('rejects credential headers', () => {
    const result = parseHeadersJson('{"Authorization": "Bearer x"}');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('reserved for credentials');
    }
  });
});

describe('draftToProfile', () => {
  it('forces the preset dialect for non-custom providers', () => {
    const draft = { ...defaultDraft('gemini', []), dialect: 'openai-chat' as const };
    expect(draftToProfile(draft).dialect).toBe('gemini-generate');
  });

  it('keeps the chosen dialect for custom providers', () => {
    const draft = {
      ...defaultDraft('custom', []),
      dialect: 'ollama-native' as const,
      baseUrl: 'https://llm.internal',
      model: 'mine',
    };
    expect(draftToProfile(draft).dialect).toBe('ollama-native');
  });
});

describe('validateDraft', () => {
  it('accepts a complete draft', () => {
    expect(validateDraft(defaultDraft('openai', [])).valid).toBe(true);
  });

  it('rejects an empty model', () => {
    const result = validateDraft({ ...defaultDraft('openai', []), model: '   ' });
    expect(result.valid).toBe(false);
    expect(result.problems.join(' ')).toContain('Model id is required');
  });

  it('rejects plain http to a remote host', () => {
    const result = validateDraft({
      ...defaultDraft('custom', []),
      baseUrl: 'http://api.example.com/v1',
      model: 'm',
    });
    expect(result.valid).toBe(false);
    expect(result.problems.join(' ')).toContain('plain http');
  });

  it('rejects out-of-range numbers', () => {
    expect(validateDraft({ ...defaultDraft('openai', []), temperature: 5 }).valid).toBe(false);
    expect(validateDraft({ ...defaultDraft('openai', []), maxOutputTokens: 1 }).valid).toBe(false);
    expect(validateDraft({ ...defaultDraft('openai', []), contextWindow: 10 }).valid).toBe(false);
  });

  it('rejects cloud endpoints in local-only mode', () => {
    const cloud = validateDraft(defaultDraft('openai', []), { localOnly: true });
    expect(cloud.valid).toBe(false);
    expect(cloud.problems.join(' ')).toContain('local-only');

    const local = validateDraft(defaultDraft('ollama', []), { localOnly: true });
    expect(local.valid).toBe(true);
  });

  it('accepts a per-profile request timeout in range', () => {
    expect(validateDraft({ ...defaultDraft('openai', []), timeoutMs: 45000 }).valid).toBe(true);
  });

  it('rejects a per-profile request timeout out of range', () => {
    expect(validateDraft({ ...defaultDraft('openai', []), timeoutMs: 1000 }).valid).toBe(false);
    expect(validateDraft({ ...defaultDraft('openai', []), timeoutMs: 400000 }).valid).toBe(false);
  });

  it('carries the timeout into the profile', () => {
    const draft = { ...defaultDraft('openai', []), timeoutMs: 45000 };
    expect(draftToProfile(draft).timeoutMs).toBe(45000);
  });
});
