import { beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { ProfileService } from '../../../src/config/profile-service.js';
import { defaultDraft, draftToProfile, type ProfileDraft } from '../../../src/config/profile-draft.js';
import type { ProviderProfile } from '../../../src/core/domain/provider-profile.js';
import { nullLogger } from '../../../src/core/ports/i-logger.js';
import { PRODUCT } from '../../../src/core/product.js';
import { readSettings, resetSettings } from '../../support/vscode-stub.js';

const service = new ProfileService(nullLogger);

function makeProfile(overrides: Partial<ProfileDraft> = {}): ProviderProfile {
  return draftToProfile({
    ...defaultDraft('openai', []),
    id: 'work',
    label: 'Work',
    model: 'gpt-4o-mini',
    ...overrides,
  });
}

beforeEach(() => {
  resetSettings();
});

describe('ProfileService settings persistence', () => {
  it('saves a profile to machine settings without any credential', async () => {
    const result = await service.add(makeProfile());
    expect(result.ok).toBe(true);

    const stored = readSettings().get(`${PRODUCT.id}.profiles`) as unknown[];
    expect(stored).toHaveLength(1);
    const serialized = JSON.stringify(stored);
    expect(serialized).not.toContain('apiKey');
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('sk-');
  });

  it('rejects duplicate ids', async () => {
    await service.add(makeProfile());
    const duplicate = await service.add(makeProfile());
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.error.message).toContain('already exists');
    }
  });

  it('rejects an insecure base URL with an actionable message', async () => {
    const result = await service.add(makeProfile({ baseUrl: 'http://api.example.com/v1' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('url_rejected');
      expect(result.error.message).toContain('plain http');
    }
    expect(readSettings().has(`${PRODUCT.id}.profiles`)).toBe(false);
  });

  it('lists saved profiles and supports switching', async () => {
    await service.add(makeProfile());
    await service.add(makeProfile({ id: 'local', label: 'Local', provider: 'ollama', baseUrl: 'http://127.0.0.1:11434' }));

    const profiles = await service.list();
    expect(profiles.map((profile) => profile.id)).toEqual(['work', 'local']);

    const selected = await service.select('local');
    expect(selected.ok).toBe(true);
    expect(readSettings().get(`${PRODUCT.id}.activeProfileId`)).toBe('local');
    expect((await service.activeProfile()).ok).toBe(true);
  });

  it('updates a profile field and clears the active pointer on removal', async () => {
    await service.add(makeProfile());
    await service.select('work');

    const updated = await service.update('work', { model: 'gpt-4.1-mini', temperature: 0.4 });
    expect(updated.ok).toBe(true);
    if (updated.ok) {
      expect(updated.value.model).toBe('gpt-4.1-mini');
      expect(updated.value.temperature).toBe(0.4);
    }

    const removed = await service.remove('work');
    expect(removed.ok).toBe(true);
    expect(readSettings().get(`${PRODUCT.id}.activeProfileId`)).toBe('');
    expect(await service.list()).toHaveLength(0);
  });

  it('removes malformed entries that the UI cannot display', async () => {
    await vscode.workspace
      .getConfiguration(PRODUCT.configSection)
      .update('profiles', [{ id: 'broken' }, makeProfile()], vscode.ConfigurationTarget.Global);

    expect(await service.list()).toHaveLength(1);
    const removed = await service.remove('broken');
    expect(removed.ok).toBe(true);
    expect(await service.list()).toHaveLength(1);
  });

  it('keeps custom headers but never credential headers', async () => {
    const withHeaders = await service.add(makeProfile({ headers: { 'X-Org': 'team' } }));
    expect(withHeaders.ok).toBe(true);

    const withCredentialHeader = await service.add(
      makeProfile({ id: 'bad', headers: { Authorization: 'Bearer x' } }),
    );
    expect(withCredentialHeader.ok).toBe(false);
  });

  it('refuses cloud profiles while local-only mode is enabled', async () => {
    await vscode.workspace
      .getConfiguration(PRODUCT.configSection)
      .update('privacy.localOnly', true, vscode.ConfigurationTarget.Global);

    const cloud = await service.add(makeProfile());
    expect(cloud.ok).toBe(false);
    if (!cloud.ok) {
      expect(cloud.error.code).toBe('url_rejected');
      expect(cloud.error.message).toContain('local-only');
    }

    const local = await service.add(
      makeProfile({
        id: 'local',
        provider: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        model: 'qwen2.5-coder:7b',
      }),
    );
    expect(local.ok).toBe(true);
  });

  it('persists a per-profile request timeout', async () => {
    const added = await service.add(makeProfile({ timeoutMs: 45000 }));
    expect(added.ok).toBe(true);

    const stored = readSettings().get(`${PRODUCT.id}.profiles`) as Array<{ timeoutMs?: number }>;
    expect(stored[0]?.timeoutMs).toBe(45000);
    expect((await service.list())[0]?.timeoutMs).toBe(45000);
  });
});

