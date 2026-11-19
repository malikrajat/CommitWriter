import * as vscode from 'vscode';
import { appError, type AppError } from '../core/domain/errors.js';
import {
  isProviderId,
  validateProfile,
  type ProviderId,
  type ProviderProfile,
  type WireDialect,
} from '../core/domain/provider-profile.js';
import { ok, err, type Result } from '../core/domain/result.js';
import { PRODUCT } from '../core/product.js';
import type { IProfileService } from '../core/ports/i-config.js';
import type { ILogger } from '../core/ports/i-logger.js';
import { presetFor } from '../providers/presets.js';
import { resolveEffectiveProfile } from '../providers/profile-resolver.js';

interface RawProfile {
  readonly id?: unknown;
  readonly label?: unknown;
  readonly provider?: unknown;
  readonly dialect?: unknown;
  readonly baseUrl?: unknown;
  readonly model?: unknown;
  readonly fallbackModel?: unknown;
  readonly contextWindow?: unknown;
  readonly temperature?: unknown;
  readonly maxOutputTokens?: unknown;
  readonly timeoutMs?: unknown;
  readonly headers?: unknown;
  readonly authStyle?: unknown;
  readonly authHeaderName?: unknown;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asRecord(value: unknown): Record<string, string> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const output: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') {
      output[key] = entry;
    }
  }
  return output;
}

function toProfile(raw: RawProfile): ProviderProfile | undefined {
  const id = asString(raw.id);
  const provider = raw.provider;
  const model = asString(raw.model);
  if (!id || !isProviderId(provider) || !model) {
    return undefined;
  }
  const preset = presetFor(provider);
  const dialectValue = asString(raw.dialect);
  const dialect: WireDialect =
    dialectValue === 'openai-chat' ||
    dialectValue === 'anthropic-messages' ||
    dialectValue === 'gemini-generate' ||
    dialectValue === 'ollama-native' ||
    dialectValue === 'opencode-session'
      ? dialectValue
      : preset.dialect;

  const authStyleValue = asString(raw.authStyle);
  const authStyle =
    authStyleValue === 'bearer' || authStyleValue === 'api-key-header' || authStyleValue === 'none'
      ? authStyleValue
      : undefined;

  return {
    id,
    label: asString(raw.label) ?? preset.label,
    provider,
    dialect,
    baseUrl: asString(raw.baseUrl) ?? preset.baseUrl,
    model,
    fallbackModel: asString(raw.fallbackModel),
    contextWindow:
      typeof raw.contextWindow === 'number' && Number.isFinite(raw.contextWindow)
        ? raw.contextWindow
        : preset.defaultContextWindow,
    temperature:
      typeof raw.temperature === 'number' && Number.isFinite(raw.temperature)
        ? Math.min(2, Math.max(0, raw.temperature))
        : 0.2,
    maxOutputTokens:
      typeof raw.maxOutputTokens === 'number' && Number.isFinite(raw.maxOutputTokens)
        ? Math.min(16384, Math.max(32, Math.round(raw.maxOutputTokens)))
        : 512,
    timeoutMs:
      typeof raw.timeoutMs === 'number' && Number.isFinite(raw.timeoutMs)
        ? Math.min(300000, Math.max(5000, Math.round(raw.timeoutMs)))
        : undefined,
    headers: asRecord(raw.headers),
    authStyle,
    authHeaderName: asString(raw.authHeaderName),
  };
}

export class ProfileService implements IProfileService {
  constructor(private readonly logger: ILogger) {}

  async list(): Promise<readonly ProviderProfile[]> {
    const config = vscode.workspace.getConfiguration(PRODUCT.configSection);

    // Machine-scoped in package.json, so workspace values are ignored by VS Code.
    // This check only makes the invariant observable in the log.
    const inspected = config.inspect<unknown[]>('profiles');
    if (inspected?.workspaceValue !== undefined || inspected?.workspaceFolderValue !== undefined) {
      this.logger.warn('ignoring workspace-scoped profile definitions (machine scope required)');
    }

    const raw = config.get<RawProfile[]>('profiles', []) ?? [];
    const profiles: ProviderProfile[] = [];
    for (const entry of raw) {
      const profile = toProfile(entry);
      if (!profile) {
        this.logger.warn('skipping malformed provider profile', { profileId: asString(entry.id) });
        continue;
      }
      const validation = validateProfile(profile);
      if (!validation.valid) {
        this.logger.warn('skipping invalid provider profile', {
          profileId: profile.id,
          problems: validation.problems.length,
        });
        continue;
      }
      profiles.push(profile);
    }
    return profiles;
  }

  async activeProfile(): Promise<Result<ProviderProfile, AppError>> {
    const profiles = await this.list();
    const configuredId = vscode.workspace.getConfiguration(PRODUCT.configSection).get<string>('activeProfileId', '');

    if (configuredId.length > 0) {
      const match = profiles.find((profile) => profile.id === configuredId);
      if (!match) {
        return {
          ok: false,
          error: appError('profile_missing', `Active profile "${configuredId}" no longer exists.`),
        };
      }
      return ok(match);
    }

    if (profiles.length === 1) {
      return ok(profiles[0]);
    }
    if (profiles.length === 0) {
      return {
        ok: false,
        error: appError('profile_missing', `No provider profile is configured. Run "${PRODUCT.displayName}: Manage Provider Profiles".`),
      };
    }
    return {
      ok: false,
      error: appError('profile_missing', `Select a provider profile with "${PRODUCT.displayName}: Select Provider Profile".`),
    };
  }

  async select(profileId: string): Promise<Result<ProviderProfile, AppError>> {
    const profiles = await this.list();
    const match = profiles.find((profile) => profile.id === profileId);
    if (!match) {
      return { ok: false, error: appError('profile_missing', `Profile "${profileId}" does not exist.`) };
    }
    await vscode.workspace
      .getConfiguration(PRODUCT.configSection)
      .update('activeProfileId', profileId, vscode.ConfigurationTarget.Global);
    return ok(match);
  }

  async ensureValidProvider(provider: ProviderId): Promise<boolean> {
    return isProviderId(provider);
  }

  async updateModel(profileId: string, model: string): Promise<Result<ProviderProfile, AppError>> {
    return this.update(profileId, { model });
  }

  async add(profile: ProviderProfile): Promise<Result<ProviderProfile, AppError>> {
    const raw = this.rawProfiles();
    if (raw.some((entry) => asString(entry.id) === profile.id)) {
      return err(appError('profile_invalid', `A profile with id "${profile.id}" already exists.`));
    }

    const validation = validateProfile(profile);
    if (!validation.valid) {
      return err(appError('profile_invalid', validation.problems.join(' ')));
    }
    const effective = resolveEffectiveProfile(profile, { localOnly: this.localOnly() });
    if (!effective.ok) {
      return effective;
    }

    await this.writeRaw([...raw, this.toRaw(effective.value)]);
    return ok(effective.value);
  }

  async update(
    profileId: string,
    patch: Partial<Omit<ProviderProfile, 'id'>>,
  ): Promise<Result<ProviderProfile, AppError>> {
    const raw = this.rawProfiles();
    const index = raw.findIndex((entry) => asString(entry.id) === profileId);
    if (index === -1) {
      return err(appError('profile_missing', `Profile "${profileId}" does not exist.`));
    }

    const existing = toProfile(raw[index] ?? {});
    if (!existing) {
      return err(appError('profile_invalid', `Profile "${profileId}" is malformed and cannot be edited.`));
    }

    const merged: ProviderProfile = { ...existing, ...patch, id: profileId };
    const validation = validateProfile(merged);
    if (!validation.valid) {
      return err(appError('profile_invalid', validation.problems.join(' ')));
    }
    const effective = resolveEffectiveProfile(merged, { localOnly: this.localOnly() });
    if (!effective.ok) {
      return effective;
    }

    const next = raw.map((entry, entryIndex) =>
      entryIndex === index ? this.toRaw(effective.value) : entry,
    );
    await this.writeRaw(next);
    return ok(effective.value);
  }

  async remove(profileId: string): Promise<Result<void, AppError>> {
    const raw = this.rawProfiles();
    const next = raw.filter((entry) => asString(entry.id) !== profileId);
    if (next.length === raw.length) {
      return err(appError('profile_missing', `Profile "${profileId}" does not exist.`));
    }
    await this.writeRaw(next);

    const config = vscode.workspace.getConfiguration(PRODUCT.configSection);
    if (config.get<string>('activeProfileId', '') === profileId) {
      await config.update('activeProfileId', '', vscode.ConfigurationTarget.Global);
    }
    return ok(undefined);
  }

  private rawProfiles(): RawProfile[] {
    return vscode.workspace.getConfiguration(PRODUCT.configSection).get<RawProfile[]>('profiles', []) ?? [];
  }

  private localOnly(): boolean {
    return vscode.workspace.getConfiguration(PRODUCT.configSection).get<boolean>('privacy.localOnly', false);
  }

  private async writeRaw(profiles: readonly RawProfile[]): Promise<void> {
    await vscode.workspace
      .getConfiguration(PRODUCT.configSection)
      .update('profiles', profiles, vscode.ConfigurationTarget.Global);
  }

  private toRaw(profile: ProviderProfile): RawProfile {
    const raw: Record<string, unknown> = {
      id: profile.id,
      label: profile.label,
      provider: profile.provider,
      dialect: profile.dialect,
      baseUrl: profile.baseUrl,
      model: profile.model,
      contextWindow: profile.contextWindow,
      temperature: profile.temperature,
      maxOutputTokens: profile.maxOutputTokens,
    };
    if (profile.fallbackModel) {
      raw['fallbackModel'] = profile.fallbackModel;
    }
    if (profile.timeoutMs !== undefined) {
      raw['timeoutMs'] = profile.timeoutMs;
    }
    if (profile.headers && Object.keys(profile.headers).length > 0) {
      raw['headers'] = profile.headers;
    }
    if (profile.authStyle) {
      raw['authStyle'] = profile.authStyle;
    }
    if (profile.authHeaderName) {
      raw['authHeaderName'] = profile.authHeaderName;
    }
    return raw as RawProfile;
  }
}
