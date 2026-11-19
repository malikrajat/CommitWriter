import { describe, expect, it } from 'vitest';
import { openAiChatDialect } from '../../../src/providers/dialect/openai-chat.js';
import { anthropicMessagesDialect } from '../../../src/providers/dialect/anthropic-messages.js';
import { geminiGenerateDialect } from '../../../src/providers/dialect/gemini-generate.js';
import type { ProviderProfile } from '../../../src/core/domain/provider-profile.js';
import type { GenerateRequest } from '../../../src/core/ports/i-provider.js';
import { neverCancelled } from '../../../src/core/domain/cancel-signal.js';

const profile: ProviderProfile = {
  id: 'p1',
  label: 'Test',
  provider: 'openai',
  dialect: 'openai-chat',
  baseUrl: 'https://api.example.com/v1',
  model: 'test-model',
  contextWindow: 128000,
  temperature: 0.2,
  maxOutputTokens: 512,
};

const request: GenerateRequest = {
  model: 'test-model',
  system: 'system',
  user: 'user',
  maxOutputTokens: 512,
  temperature: 0.2,
  timeoutMs: 1000,
  maxRetries: 0,
  signal: neverCancelled,
};

describe('openai-chat dialect', () => {
  it('builds a chat completion request', () => {
    const built = openAiChatDialect.buildGenerate({ profile, authHeaders: { authorization: 'Bearer k' } }, request);
    expect(built.url).toBe('https://api.example.com/v1/chat/completions');
    expect(built.headers['authorization']).toBe('Bearer k');
    const body = JSON.parse(built.body) as Record<string, unknown>;
    expect(body['model']).toBe('test-model');
    expect((body['messages'] as unknown[]).length).toBe(2);
    expect(body['stream']).toBe(false);
  });

  it('parses a completion with usage', () => {
    const parsed = openAiChatDialect.parseGenerate(
      200,
      JSON.stringify({
        id: 'req_1',
        choices: [{ message: { content: 'feat: thing' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.text).toBe('feat: thing');
      expect(parsed.value.usage).toEqual({ input: 10, output: 5 });
    }
  });

  it('rejects an empty completion', () => {
    const parsed = openAiChatDialect.parseGenerate(200, JSON.stringify({ choices: [] }));
    expect(parsed.ok).toBe(false);
  });
});

describe('anthropic dialect', () => {
  it('uses the messages endpoint and version header', () => {
    const built = anthropicMessagesDialect.buildGenerate(
      { profile: { ...profile, baseUrl: 'https://api.anthropic.com' }, authHeaders: { 'x-api-key': 'k' } },
      request,
    );
    expect(built.url).toBe('https://api.anthropic.com/v1/messages');
    expect(built.headers['anthropic-version']).toBeDefined();
    expect(built.headers['x-api-key']).toBe('k');
  });

  it('concatenates text blocks', () => {
    const parsed = anthropicMessagesDialect.parseGenerate(
      200,
      JSON.stringify({
        content: [
          { type: 'text', text: 'feat: ' },
          { type: 'text', text: 'thing' },
        ],
        stop_reason: 'end_turn',
      }),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.text).toBe('feat: thing');
    }
  });
});

describe('gemini dialect', () => {
  it('puts the API key in a header, never in the URL', () => {
    const built = geminiGenerateDialect.buildGenerate(
      {
        profile: {
          ...profile,
          provider: 'gemini',
          dialect: 'gemini-generate',
          baseUrl: 'https://generativelanguage.googleapis.com',
        },
        authHeaders: { 'x-goog-api-key': 'secret-key' },
      },
      request,
    );
    expect(built.url).toContain(':generateContent');
    expect(built.url).not.toContain('secret-key');
    expect(built.headers['x-goog-api-key']).toBe('secret-key');
  });

  it('parses candidate text', () => {
    const parsed = geminiGenerateDialect.parseGenerate(
      200,
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'fix: thing' }] }, finishReason: 'STOP' }],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.text).toBe('fix: thing');
    }
  });
});
