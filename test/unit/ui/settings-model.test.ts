import { describe, expect, it } from 'vitest';
import { PRODUCT } from '../../../src/core/product.js';
import type { ProviderProfile } from '../../../src/core/domain/provider-profile.js';
import type { ResolvedConfig } from '../../../src/core/ports/i-config.js';
import {
  buildSettingsModel,
  filterSettingsModel,
  isToggleKey,
} from '../../../src/ui/settings-model.js';

const config: ResolvedConfig = {
  mode: 'smart',
  modeOverrides: {},
  context: {
    includeStaged: true,
    includeUnstaged: false,
    includeUntracked: false,
    maxDiffTokens: 12000,
    maxFiles: 200,
    maxFileBytes: 262144,
    maxFileDiffLines: 400,
    excludeGlobs: [],
  },
  style: { learnFromHistory: true, historySamples: 30 },
  conventional: {
    enabled: true,
    types: ['feat'],
    maxSubjectLength: 72,
    requireScope: false,
    allowedScopes: [],
  },
  output: {
    language: 'en',
    includeBody: true,
    includeIssueKeyFromBranch: false,
    attribution: 'none',
    overwriteDraft: 'ask',
  },
  provider: { timeoutMs: 120000, maxRetries: 2 },
  privacy: { localOnly: false },
  statusBarEnabled: true,
  logLevel: 'warn',
};

const profile: ProviderProfile = {
  id: 'work',
  label: 'Work',
  provider: 'openai',
  dialect: 'openai-chat',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  contextWindow: 128000,
  temperature: 0.2,
  maxOutputTokens: 512,
};

function model(overrides: Partial<ResolvedConfig> = {}) {
  return buildSettingsModel({ ...config, ...overrides }, [profile], 'work');
}

describe('settings model', () => {
  it('describes every section and item', () => {
    const view = model();
    expect(view.title).toBe(PRODUCT.displayName);
    expect(view.sections.map((section) => section.id)).toEqual([
      'provider',
      'changes',
      'message',
      'privacy',
      'help',
    ]);
    for (const section of view.sections) {
      expect(section.description.length).toBeGreaterThan(10);
      for (const item of section.items) {
        expect(item.description.length, item.label).toBeGreaterThan(10);
      }
    }
  });

  it('reflects the active provider and current values', () => {
    const view = model();
    const provider = view.sections.find((section) => section.id === 'provider');
    expect(provider?.items[0]?.value).toContain('Work');
    const message = view.sections.find((section) => section.id === 'message');
    expect(message?.items.find((item) => item.id === 'mode')?.value).toBe('smart');
    expect(message?.items.find((item) => item.id === 'budget')?.value).toBe('12000 tokens');
  });

  it('reflects toggle state from configuration', () => {
    const view = model({
      context: { ...config.context, includeUnstaged: true },
      privacy: { localOnly: true },
    });
    const changes = view.sections.find((section) => section.id === 'changes');
    expect(changes?.items.find((item) => item.settingKey === 'context.includeUnstaged')?.checked).toBe(true);
    const privacy = view.sections.find((section) => section.id === 'privacy');
    expect(privacy?.items.find((item) => item.settingKey === 'privacy.localOnly')?.checked).toBe(true);
  });

  it('filters by label, description or value', () => {
    const filtered = filterSettingsModel(model(), 'timeout');
    expect(filtered.sections).toHaveLength(1);
    expect(filtered.sections[0]?.id).toBe('message');
    expect(filtered.sections[0]?.items.map((item) => item.id)).toEqual(['timeout']);

    const staged = filterSettingsModel(model(), 'untracked');
    expect(staged.sections[0]?.id).toBe('changes');
    expect(staged.sections[0]?.items.map((item) => item.id)).toEqual(['untracked']);
  });

  it('returns an empty model for no matches', () => {
    expect(filterSettingsModel(model(), 'zzzz').sections).toEqual([]);
  });

  it('recognises only supported toggle keys', () => {
    expect(isToggleKey('context.includeStaged')).toBe(true);
    expect(isToggleKey('privacy.localOnly')).toBe(true);
    expect(isToggleKey('context.maxFiles')).toBe(false);
  });

  it('only points at product commands or the settings editor', () => {
    const view = model();
    for (const section of view.sections) {
      for (const item of section.items) {
        if (!item.command) {
          continue;
        }
        const allowed =
          item.command.startsWith(`${PRODUCT.id}.`) || item.command === 'workbench.action.openSettings';
        expect(allowed, item.command).toBe(true);
      }
    }
  });
});
