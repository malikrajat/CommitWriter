import * as vscode from 'vscode';
import { neverCancelled } from '../core/domain/cancel-signal.js';
import { PRODUCT } from '../core/product.js';
import type { AppError } from '../core/domain/errors.js';
import {
  isProviderId,
  validateProfile,
  type ProfileAuthStyle,
  type ProviderId,
  type ProviderProfile,
  type WireDialect,
} from '../core/domain/provider-profile.js';
import type { IClock } from '../core/ports/i-clock.js';
import type { IConfig } from '../core/ports/i-config.js';
import type { ILogger } from '../core/ports/i-logger.js';
import type { ISecretStore } from '../core/ports/i-secret-store.js';
import { evaluateUrl } from '../core/security/url-policy.js';
import type { ProviderRegistry } from '../providers/registry.js';
import { presetFor, PROVIDER_PRESETS } from '../providers/presets.js';
import { resolveEffectiveProfile } from '../providers/profile-resolver.js';
import { confirm, pickProfile } from '../ui/dialogs.js';
import type { ProfileService } from './profile-service.js';
import {
  CUSTOM_DIALECTS,
  defaultDraft,
  draftToProfile,
  parseHeadersJson,
  validateDraft,
  type ProfileDraft,
} from './profile-draft.js';

const brand = (text: string): string => `${PRODUCT.displayName}: ${text}`;

type HubAction =
  | 'add'
  | 'edit'
  | 'remove'
  | 'switch'
  | 'test'
  | 'validate'
  | 'key'
  | 'timeout'
  | 'tokens'
  | 'conventional'
  | 'localOnly'
  | 'selection'
  | 'json';

export interface SettingsDeps {
  readonly profiles: ProfileService;
  readonly secrets: ISecretStore;
  readonly registry: ProviderRegistry;
  readonly config: IConfig;
  readonly clock: IClock;
  readonly logger: ILogger;
}

const DIALECT_LABELS: Readonly<Record<WireDialect, string>> = {
  'openai-chat': 'OpenAI-compatible chat completions',
  'anthropic-messages': 'Anthropic messages',
  'gemini-generate': 'Google Gemini generateContent',
  'ollama-native': 'Ollama native chat',
  'opencode-session': 'OpenCode session',
};

export function describeConnectionError(error: AppError, profile: ProviderProfile): string {
  switch (error.code) {
    case 'secret_missing':
      return `No API key is stored for "${profile.label}". Use "${PRODUCT.displayName}: Set API Key".`;
    case 'auth':
      return `Authentication failed for "${profile.label}" (HTTP ${error.httpStatus ?? 401}). Check the API key and base URL.`;
    case 'network':
      return `Cannot reach ${safeOrigin(profile.baseUrl)}. Check the base URL, network and proxy.`;
    case 'tls':
      return `TLS negotiation with ${safeOrigin(profile.baseUrl)} failed. The certificate must be valid.`;
    case 'timeout':
      return `The request to ${safeOrigin(profile.baseUrl)} timed out. Increase the request timeout or check the endpoint.`;
    case 'rate_limit':
      return 'The provider is rate limiting requests. Try again shortly.';
    case 'quota':
      return 'The provider reports no remaining quota or credits.';
    case 'context_overflow':
      return 'The endpoint rejected the request because it is too large.';
    case 'bad_request':
      return error.message;
    case 'server':
      return 'The provider returned a server error (5xx). Try again later.';
    case 'cancelled':
      return 'The connection test was cancelled.';
    default:
      return error.message;
  }
}

function safeOrigin(rawUrl: string): string {
  const evaluated = evaluateUrl(rawUrl, 'custom');
  return evaluated.ok ? evaluated.value.origin : rawUrl;
}

function secretKindFor(profile: ProviderProfile): 'apiKey' | 'basicPassword' {
  return profile.provider === 'opencode' ? 'basicPassword' : 'apiKey';
}

interface ProfilePatch {
  label?: string;
  baseUrl?: string;
  model?: string;
  fallbackModel?: string;
  dialect?: WireDialect;
  contextWindow?: number;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  headers?: Readonly<Record<string, string>>;
  authStyle?: ProfileAuthStyle;
  authHeaderName?: string;
}

export class SettingsController {
  constructor(private readonly deps: SettingsDeps) {}

  async openHub(): Promise<void> {
    const config = this.deps.config.read();
    const items: Array<{ label: string; description?: string; action: HubAction }> = [
      { label: '$(add) Add provider...', action: 'add' },
      { label: '$(edit) Edit provider...', action: 'edit' },
      { label: '$(trash) Remove provider...', action: 'remove' },
      { label: '$(check) Switch active provider...', action: 'switch', description: this.describeActive() },
      { label: '$(plug) Test connection...', action: 'test' },
      { label: '$(beaker) Validate configuration', action: 'validate' },
      { label: '$(key) Set API key...', action: 'key' },
      { label: '$(clock) Request timeout...', description: `${config.provider.timeoutMs} ms`, action: 'timeout' },
      {
        label: '$(symbol-numeric) Token budget...',
        description: `${config.context.maxDiffTokens} tokens`,
        action: 'tokens',
      },
      {
        label: '$(checklist) Conventional Commits...',
        description: config.conventional.enabled ? 'enabled' : 'disabled',
        action: 'conventional',
      },
      {
        label: '$(shield) Local-only mode...',
        description: config.privacy.localOnly ? 'enabled' : 'disabled',
        action: 'localOnly',
      },
      {
        label: '$(list-selection) Changes to analyse...',
        description: this.selectionDescription(),
        action: 'selection',
      },
      { label: '$(json) Open settings.json', action: 'json' },
    ];

    const picked = await vscode.window.showQuickPick(items, {
      title: brand('provider settings'),
      placeHolder: 'Configure providers, credentials and generation limits',
    });
    if (!picked) {
      return;
    }

    switch (picked.action) {
      case 'add':
        return this.addProvider();
      case 'edit':
        return this.editProvider();
      case 'remove':
        return this.removeProvider();
      case 'switch':
        return this.selectProvider();
      case 'test':
        return this.testConnection();
      case 'validate':
        return this.validateProfiles();
      case 'key':
        return this.setApiKey();
      case 'timeout':
        return this.editTimeout();
      case 'tokens':
        return this.editTokenBudget();
      case 'conventional':
        return this.editConventional();
      case 'localOnly':
        return this.editLocalOnly();
      case 'selection':
        return this.editSelection();
      case 'json':
        return this.openSettingsJson();
    }
  }

  async selectProvider(): Promise<void> {
    const profiles = await this.deps.profiles.list();
    if (profiles.length === 0) {
      await this.offerAddProvider();
      return;
    }
    const picked = await pickProfile(profiles);
    if (!picked) {
      return;
    }
    const selected = await this.deps.profiles.select(picked.id);
    if (!selected.ok) {
      await this.showError(selected.error.message);
      return;
    }
    void vscode.window.showInformationMessage(brand(`active provider is "${picked.label}".`));
  }

  async setApiKey(): Promise<void> {
    const profiles = await this.deps.profiles.list();
    if (profiles.length === 0) {
      await this.offerAddProvider();
      return;
    }
    const picked = (await pickProfile(profiles, 'Choose the provider to configure')) ?? profiles[0];
    const kind = secretKindFor(picked);
    const value = await vscode.window.showInputBox({
      title:
        kind === 'basicPassword'
          ? `OpenCode server password for ${picked.label}`
          : `API key for ${picked.label}`,
      prompt: 'Stored in the OS keychain. It is never written to settings.json or logs.',
      password: true,
      ignoreFocusOut: true,
      validateInput: (input) => (input.trim().length === 0 ? 'The value must not be empty.' : undefined),
    });
    if (value === undefined) {
      return;
    }
    const stored = await this.deps.secrets.put(picked.id, kind, value);
    if (!stored.ok) {
      await this.showError(stored.error.message);
      return;
    }
    void vscode.window.showInformationMessage(
      brand(`credential stored for "${picked.label}" (${stored.value.lastFour ?? '****'}).`),
    );
  }

  async clearApiKey(): Promise<void> {
    const profiles = await this.deps.profiles.list();
    if (profiles.length === 0) {
      return;
    }
    const picked = await pickProfile(profiles, 'Remove the stored credential for...');
    if (!picked) {
      return;
    }
    const confirmed = await confirm(`Remove the stored credential for "${picked.label}"?`, 'Remove');
    if (!confirmed) {
      return;
    }
    await this.deps.secrets.delete(picked.id, 'apiKey');
    await this.deps.secrets.delete(picked.id, 'basicPassword');
    void vscode.window.showInformationMessage(brand('credential removed.'));
  }

  async addProvider(): Promise<void> {
    const providerPick = await vscode.window.showQuickPick(
      (Object.values(PROVIDER_PRESETS) as ReadonlyArray<(typeof PROVIDER_PRESETS)[ProviderId]>).map((preset) => ({
        label: preset.label,
        description: `${DIALECT_LABELS[preset.dialect]} | ${preset.baseUrl || 'custom base URL'}`,
        provider: preset.id,
      })),
      { title: 'Add provider - choose a provider' },
    );
    if (!providerPick || !isProviderId(providerPick.provider)) {
      return;
    }
    const provider = providerPick.provider;
    const preset = presetFor(provider);
    const existing = (await this.deps.profiles.list()).map((profile) => profile.id);
    const base = defaultDraft(provider, existing);

    const baseUrl = await this.askString(`Base URL for ${preset.label}`, base.baseUrl, (input) => {
      const check = evaluateUrl(input, provider, {
        localOnly: this.deps.config.read().privacy.localOnly,
      });
      return check.ok ? undefined : check.error.message;
    });
    if (baseUrl === undefined) {
      return;
    }

    const id = await this.askString('Profile id', base.id, (input) => {
      if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(input)) {
        return 'Use 2-31 lowercase letters, digits or dashes.';
      }
      return existing.includes(input) ? 'A profile with this id already exists.' : undefined;
    });
    if (!id) {
      return;
    }

    const label = await this.askString('Display name', base.label);
    if (label === undefined) {
      return;
    }

    let dialect = base.dialect;
    if (provider === 'custom') {
      const picked = await vscode.window.showQuickPick(
        CUSTOM_DIALECTS.map((entry) => ({ label: DIALECT_LABELS[entry], description: entry, dialect: entry })),
        { title: 'API format', placeHolder: 'How should requests be formatted?' },
      );
      if (!picked) {
        return;
      }
      dialect = picked.dialect;
    }

    let authStyle: ProfileAuthStyle | undefined = base.authStyle;
    let authHeaderName: string | undefined;
    if (provider === 'custom') {
      const picked = await vscode.window.showQuickPick(
        [
          { label: 'Bearer token', description: 'Authorization: Bearer ...', style: 'bearer' as const },
          { label: 'API key header', description: 'Custom header name', style: 'api-key-header' as const },
          { label: 'No authentication', description: 'Local or open endpoint', style: 'none' as const },
        ],
        { title: 'Authentication' },
      );
      if (!picked) {
        return;
      }
      authStyle = picked.style;
      if (authStyle === 'api-key-header') {
        authHeaderName = await this.askString('API key header name', 'x-api-key', (input) =>
          /^[A-Za-z0-9-]+$/.test(input) ? undefined : 'Use a valid HTTP header name.',
        );
        if (authHeaderName === undefined) {
          return;
        }
      }
    }

    let credential: string | undefined;
    if (provider === 'opencode') {
      credential = await vscode.window.showInputBox({
        title: 'OpenCode server password (optional)',
        prompt: 'Matches OPENCODE_SERVER_PASSWORD. Leave empty when the server has no password.',
        password: true,
        ignoreFocusOut: true,
      });
      if (credential === undefined) {
        return;
      }
      if (credential.trim().length === 0) {
        credential = undefined;
      }
    } else if (preset.auth !== 'none' && authStyle !== 'none') {
      credential = await vscode.window.showInputBox({
        title: `API key for ${label}`,
        prompt: 'Stored in the OS keychain. It is never written to settings.json or logs.',
        password: true,
        ignoreFocusOut: true,
        validateInput: (input) => (input.trim().length === 0 ? 'The key must not be empty.' : undefined),
      });
      if (credential === undefined) {
        return;
      }
    }

    const model = await this.askString(
      'Model id',
      base.model,
      (input) => (input.trim().length === 0 ? 'Model id is required.' : undefined),
    );
    if (model === undefined) {
      return;
    }

    const draft: ProfileDraft = {
      id,
      label,
      provider,
      dialect,
      baseUrl,
      model,
      contextWindow: base.contextWindow,
      temperature: base.temperature,
      maxOutputTokens: base.maxOutputTokens,
      timeoutMs: base.timeoutMs,
      authStyle,
      authHeaderName,
    };

    const advanced = await vscode.window.showQuickPick(
      [
        { label: 'Use default advanced settings', detail: `temperature 0.2 | max output 512 | context ${base.contextWindow}` },
        { label: 'Configure advanced options...' },
      ],
      { title: 'Advanced options' },
    );
    if (!advanced) {
      return;
    }

    let finalDraft = draft;
    if (advanced.label.startsWith('Configure')) {
      const configured = await this.askAdvanced(draft);
      if (!configured) {
        return;
      }
      finalDraft = configured;
    }

    const validation = validateDraft(finalDraft, {
      localOnly: this.deps.config.read().privacy.localOnly,
    });
    if (!validation.valid) {
      await this.showError(validation.problems.join('\n'));
      return;
    }

    const saved = await this.deps.profiles.add(draftToProfile(finalDraft));
    if (!saved.ok) {
      await this.showError(saved.error.message);
      return;
    }

    if (credential) {
      const stored = await this.deps.secrets.put(id, secretKindFor(saved.value), credential);
      if (!stored.ok) {
        await this.showError(stored.error.message);
        return;
      }
    }

    await this.deps.profiles.select(id);
    const choice = await vscode.window.showInformationMessage(
      brand(`"${label}" added and selected.`),
      'Test Connection',
    );
    if (choice === 'Test Connection') {
      await this.testProfile(saved.value);
    }
  }

  async editProvider(): Promise<void> {
    const profiles = await this.deps.profiles.list();
    if (profiles.length === 0) {
      await this.offerAddProvider();
      return;
    }
    const profile = await pickProfile(profiles, 'Edit provider');
    if (!profile) {
      return;
    }

    const fields: Array<{ label: string; description?: string; field: string }> = [
      { label: 'Display name', description: profile.label, field: 'label' },
      { label: 'Base URL', description: profile.baseUrl, field: 'baseUrl' },
      { label: 'Model id', description: profile.model, field: 'model' },
      { label: 'Temperature', description: String(profile.temperature), field: 'temperature' },
      { label: 'Max output tokens', description: String(profile.maxOutputTokens), field: 'maxOutputTokens' },
      {
        label: 'Request timeout',
        description: profile.timeoutMs ? `${profile.timeoutMs} ms` : 'inherit global',
        field: 'timeoutMs',
      },
      { label: 'Context window', description: String(profile.contextWindow), field: 'contextWindow' },
      { label: 'Custom HTTP headers', field: 'headers' },
      { label: 'API key', field: 'apiKey' },
    ];
    if (profile.provider === 'custom') {
      fields.splice(2, 0, {
        label: 'API format',
        description: DIALECT_LABELS[profile.dialect],
        field: 'dialect',
      });
      fields.push({ label: 'Authentication style', description: profile.authStyle ?? 'bearer', field: 'authStyle' });
    }

    const picked = await vscode.window.showQuickPick(fields, { title: `Edit "${profile.label}"` });
    if (!picked) {
      return;
    }

    if (picked.field === 'apiKey') {
      const kind = secretKindFor(profile);
      const value = await vscode.window.showInputBox({
        title: `New ${kind === 'basicPassword' ? 'server password' : 'API key'} for ${profile.label}`,
        password: true,
        ignoreFocusOut: true,
        validateInput: (input) => (input.trim().length === 0 ? 'The value must not be empty.' : undefined),
      });
      if (value === undefined) {
        return;
      }
      const stored = await this.deps.secrets.put(profile.id, kind, value);
      if (!stored.ok) {
        await this.showError(stored.error.message);
      } else {
        void vscode.window.showInformationMessage(brand('credential updated.'));
      }
      return;
    }

    const patch: ProfilePatch = {};

    if (picked.field === 'label') {
      const value = await this.askString('Display name', profile.label);
      if (value === undefined) {
        return;
      }
      patch.label = value;
    } else if (picked.field === 'baseUrl') {
      const value = await this.askString('Base URL', profile.baseUrl, (input) => {
        const check = evaluateUrl(input, profile.provider, {
          localOnly: this.deps.config.read().privacy.localOnly,
        });
        return check.ok ? undefined : check.error.message;
      });
      if (value === undefined) {
        return;
      }
      patch.baseUrl = value;
    } else if (picked.field === 'model') {
      const value = await this.chooseModel(profile);
      if (value === undefined) {
        return;
      }
      patch.model = value;
    } else if (picked.field === 'dialect') {
      const value = await vscode.window.showQuickPick(
        CUSTOM_DIALECTS.map((entry) => ({ label: DIALECT_LABELS[entry], description: entry, dialect: entry })),
        { title: 'API format' },
      );
      if (!value) {
        return;
      }
      patch.dialect = value.dialect;
    } else if (picked.field === 'authStyle') {
      const value = await vscode.window.showQuickPick(
        [
          { label: 'Bearer token', style: 'bearer' as const },
          { label: 'API key header', style: 'api-key-header' as const },
          { label: 'No authentication', style: 'none' as const },
        ],
        { title: 'Authentication style' },
      );
      if (!value) {
        return;
      }
      patch.authStyle = value.style;
      if (value.style === 'api-key-header') {
        const name = await this.askString('API key header name', profile.authHeaderName ?? 'x-api-key', (input) =>
          /^[A-Za-z0-9-]+$/.test(input) ? undefined : 'Use a valid HTTP header name.',
        );
        if (name === undefined) {
          return;
        }
        patch.authHeaderName = name;
      }
    } else if (picked.field === 'temperature') {
      const value = await this.askFloat('Temperature (0-2)', profile.temperature, 0, 2);
      if (value === undefined) {
        return;
      }
      patch.temperature = value;
    } else if (picked.field === 'maxOutputTokens') {
      const value = await this.askNumber('Max output tokens', profile.maxOutputTokens, 32, 16384);
      if (value === undefined) {
        return;
      }
      patch.maxOutputTokens = value;
    } else if (picked.field === 'timeoutMs') {
      const text = await this.askString(
        'Request timeout in ms (empty to inherit the global ceiling)',
        profile.timeoutMs ? String(profile.timeoutMs) : '',
        (input) => {
          if (input.trim().length === 0) {
            return undefined;
          }
          const value = Number(input);
          return Number.isInteger(value) && value >= 5000 && value <= 300000
            ? undefined
            : 'Enter an integer between 5000 and 300000, or leave empty.';
        },
      );
      if (text === undefined) {
        return;
      }
      patch.timeoutMs = text.trim().length === 0 ? undefined : Number(text);
    } else if (picked.field === 'contextWindow') {
      const value = await this.askNumber('Context window (tokens)', profile.contextWindow, 1024, 2000000);
      if (value === undefined) {
        return;
      }
      patch.contextWindow = value;
    } else if (picked.field === 'headers') {
      const current = profile.headers ? JSON.stringify(profile.headers, null, 2) : '{}';
      const text = await vscode.window.showInputBox({
        title: 'Custom HTTP headers (JSON)',
        value: current,
        ignoreFocusOut: true,
        validateInput: (input) => {
          const parsed = parseHeadersJson(input);
          return parsed.ok ? undefined : parsed.message;
        },
      });
      if (text === undefined) {
        return;
      }
      const parsed = parseHeadersJson(text);
      if (!parsed.ok) {
        return;
      }
      patch.headers = parsed.headers;
    }

    const updated = await this.deps.profiles.update(profile.id, patch);
    if (!updated.ok) {
      await this.showError(updated.error.message);
      return;
    }
    void vscode.window.showInformationMessage(brand(`"${updated.value.label}" updated.`));
  }

  async removeProvider(): Promise<void> {
    const profiles = await this.deps.profiles.list();
    if (profiles.length === 0) {
      void vscode.window.showInformationMessage(brand('no provider profiles to remove.'));
      return;
    }
    const profile = await pickProfile(profiles, 'Remove provider');
    if (!profile) {
      return;
    }
    const confirmed = await confirm(
      `Remove "${profile.label}" and its stored credential? This cannot be undone.`,
      'Remove Provider',
    );
    if (!confirmed) {
      return;
    }
    const removed = await this.deps.profiles.remove(profile.id);
    if (!removed.ok) {
      await this.showError(removed.error.message);
      return;
    }
    await this.deps.secrets.delete(profile.id, 'apiKey');
    await this.deps.secrets.delete(profile.id, 'basicPassword');
    void vscode.window.showInformationMessage(brand(`"${profile.label}" removed.`));
  }

  async testConnection(): Promise<void> {
    const profiles = await this.deps.profiles.list();
    if (profiles.length === 0) {
      await this.offerAddProvider();
      return;
    }
    const profile = await pickProfile(profiles, 'Test connection');
    if (!profile) {
      return;
    }
    await this.testProfile(profile);
  }

  async testProfile(profile: ProviderProfile): Promise<void> {
    const effective = resolveEffectiveProfile(profile, {
      localOnly: this.deps.config.read().privacy.localOnly,
    });
    if (!effective.ok) {
      await this.showError(effective.error.message);
      return;
    }

    const started = this.deps.clock.now();
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: brand(`testing ${profile.label}...`),
      },
      () => this.deps.registry.get(effective.value).listModels(effective.value, neverCancelled),
    );
    const elapsed = this.deps.clock.now() - started;

    if (result.ok) {
      this.deps.logger.info('connection test succeeded', {
        providerId: profile.provider,
        models: result.value.length,
        durationMs: elapsed,
      });
      void vscode.window.showInformationMessage(
        brand(`"${profile.label}" connected in ${elapsed} ms (${result.value.length} model${result.value.length === 1 ? '' : 's'} available).`),
      );
      return;
    }

    this.deps.logger.warn('connection test failed', { code: result.error.code });
    const message = describeConnectionError(result.error, effective.value);
    const actions =
      result.error.code === 'secret_missing' || result.error.code === 'auth'
        ? ['Set API Key', 'Edit Provider']
        : ['Edit Provider'];
    const choice = await vscode.window.showErrorMessage(message, ...actions);
    if (choice === 'Set API Key') {
      await this.setApiKey();
    } else if (choice === 'Edit Provider') {
      await this.editProvider();
    }
  }

  async validateProfiles(): Promise<void> {
    const profiles = await this.deps.profiles.list();
    if (profiles.length === 0) {
      await this.offerAddProvider();
      return;
    }

    const results: Array<{ label: string; description: string; problems: readonly string[] }> = [];
    for (const profile of profiles) {
      const problems: string[] = [];
      const validation = validateProfile(profile);
      if (!validation.valid) {
        problems.push(...validation.problems);
      }
      const effective = resolveEffectiveProfile(profile, {
        localOnly: this.deps.config.read().privacy.localOnly,
      });
      if (!effective.ok) {
        problems.push(effective.error.message);
      }
      if (presetFor(profile.provider).auth !== 'none') {
        const descriptor = await this.deps.secrets.describe(profile.id, secretKindFor(profile));
        if (!descriptor.present) {
          problems.push('no credential stored');
        }
      }
      results.push({
        label: problems.length === 0 ? `$(check) ${profile.label}` : `$(warning) ${profile.label}`,
        description: problems.length === 0 ? 'valid' : problems.join(' | '),
        problems,
      });
    }

    const invalid = results.filter((result) => result.problems.length > 0);
    if (invalid.length === 0) {
      void vscode.window.showInformationMessage(
        brand(`all ${results.length} provider profile${results.length === 1 ? '' : 's'} are valid.`),
      );
      return;
    }
    await vscode.window.showQuickPick(results, {
      title: `Configuration issues (${invalid.length} of ${results.length})`,
      placeHolder: 'Profiles with problems are listed first',
    });
  }

  private async askAdvanced(draft: ProfileDraft): Promise<ProfileDraft | undefined> {
    const temperature = await this.askFloat('Temperature (0-2)', draft.temperature, 0, 2);
    if (temperature === undefined) {
      return undefined;
    }
    const maxOutputTokens = await this.askNumber('Max output tokens', draft.maxOutputTokens, 32, 16384);
    if (maxOutputTokens === undefined) {
      return undefined;
    }
    const contextWindow = await this.askNumber('Context window (tokens)', draft.contextWindow, 1024, 2000000);
    if (contextWindow === undefined) {
      return undefined;
    }
    const timeoutText = await this.askString(
      'Request timeout in ms (empty to inherit the global ceiling)',
      draft.timeoutMs ? String(draft.timeoutMs) : '',
      (input) => {
        if (input.trim().length === 0) {
          return undefined;
        }
        const value = Number(input);
        return Number.isInteger(value) && value >= 5000 && value <= 300000
          ? undefined
          : 'Enter an integer between 5000 and 300000, or leave empty.';
      },
    );
    if (timeoutText === undefined) {
      return undefined;
    }
    const timeoutMs = timeoutText.trim().length === 0 ? undefined : Number(timeoutText);
    const headersText = await vscode.window.showInputBox({
      title: 'Custom HTTP headers (JSON, optional)',
      value: draft.headers ? JSON.stringify(draft.headers) : '{}',
      ignoreFocusOut: true,
      validateInput: (input) => {
        const parsed = parseHeadersJson(input);
        return parsed.ok ? undefined : parsed.message;
      },
    });
    if (headersText === undefined) {
      return undefined;
    }
    const headers = parseHeadersJson(headersText);
    if (!headers.ok) {
      return undefined;
    }
    return { ...draft, temperature, maxOutputTokens, contextWindow, timeoutMs, headers: headers.headers };
  }

  private async chooseModel(profile: ProviderProfile): Promise<string | undefined> {
    const effective = resolveEffectiveProfile(profile, {
      localOnly: this.deps.config.read().privacy.localOnly,
    });
    if (effective.ok) {
      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: brand(`loading models for ${profile.label}...`),
        },
        () => this.deps.registry.get(effective.value).listModels(effective.value, neverCancelled),
      );
      if (result.ok && result.value.length > 0) {
        const items = result.value.map((model) => ({ label: model.id, description: model.label }));
        items.unshift({ label: '$(edit) Enter a model id manually', description: profile.model });
        const picked = await vscode.window.showQuickPick(items, {
          title: `Model for ${profile.label}`,
          placeHolder: profile.model,
        });
        if (!picked) {
          return undefined;
        }
        if (!picked.label.startsWith('$(edit)')) {
          return picked.label;
        }
      } else if (!result.ok) {
        this.deps.logger.warn('model listing failed during edit', { code: result.error.code });
      }
    }

    return this.askString('Model id', profile.model, (input) =>
      input.trim().length === 0 ? 'Model id is required.' : undefined,
    );
  }

  private selectionDescription(): string {
    const context = this.deps.config.read().context;
    const parts: string[] = [];
    if (context.includeStaged) {
      parts.push('staged');
    }
    if (context.includeUnstaged) {
      parts.push('unstaged');
    }
    if (context.includeUntracked) {
      parts.push('untracked');
    }
    return parts.length > 0 ? parts.join(' + ') : 'none';
  }

  private async editSelection(): Promise<void> {
    const context = this.deps.config.read().context;
    const items = [
      { label: 'Staged changes', description: 'Git index', key: 'staged', picked: context.includeStaged },
      {
        label: 'Unstaged changes',
        description: 'Working tree, including conflicts',
        key: 'unstaged',
        picked: context.includeUnstaged,
      },
      {
        label: 'Untracked files',
        description: 'New files that are not added to Git',
        key: 'untracked',
        picked: context.includeUntracked,
      },
    ];
    const picked = await vscode.window.showQuickPick(items, {
      title: 'Changes to analyse',
      placeHolder: 'Select at least one source',
      canPickMany: true,
    });
    if (!picked) {
      return;
    }
    if (picked.length === 0) {
      void vscode.window.showErrorMessage(brand('select at least one change source.'));
      return;
    }
    const keys = new Set(picked.map((item) => item.key));
    await this.updateSetting('context.includeStaged', keys.has('staged'));
    await this.updateSetting('context.includeUnstaged', keys.has('unstaged'));
    await this.updateSetting('context.includeUntracked', keys.has('untracked'));
    void vscode.window.showInformationMessage(
      brand(`analysing ${this.selectionDescription()}.`),
    );
  }

  async editMode(): Promise<void> {
    const current = this.deps.config.read().mode;
    const picked = await vscode.window.showQuickPick(
      [
        { label: 'Quick', description: 'One request, subject only', value: 'quick' as const },
        { label: 'Smart', description: 'Adapts between single-pass and chunked analysis', value: 'smart' as const },
        { label: 'Detailed', description: 'Deep chunk analysis with the largest budget', value: 'detailed' as const },
      ],
      { title: 'Generation mode', placeHolder: `Current: ${current}` },
    );
    if (!picked) {
      return;
    }
    await this.updateSetting('mode', picked.value);
    void vscode.window.showInformationMessage(
      brand(`generation mode set to ${picked.label.toLowerCase()}.`),
    );
  }

  async editTimeout(): Promise<void> {
    const current = this.deps.config.read().provider.timeoutMs;
    const value = await this.askNumber('Request timeout (milliseconds)', current, 5000, 300000);
    if (value === undefined) {
      return;
    }
    await this.updateSetting('provider.timeoutMs', value);
    void vscode.window.showInformationMessage(brand(`request timeout set to ${value} ms.`));
  }

  async editTokenBudget(): Promise<void> {
    const current = this.deps.config.read().context.maxDiffTokens;
    const value = await this.askNumber('Maximum diff token budget', current, 500, 200000);
    if (value === undefined) {
      return;
    }
    await this.updateSetting('context.maxDiffTokens', value);
    void vscode.window.showInformationMessage(brand(`token budget set to ${value} tokens.`));
  }

  private async editConventional(): Promise<void> {
    const config = vscode.workspace.getConfiguration(PRODUCT.configSection);
    const enabled = config.get<boolean>('conventional.enabled', true);
    const picked = await vscode.window.showQuickPick(
      [
        { label: `$(check) Enabled`, description: 'Validate and repair Conventional Commits', value: true },
        { label: `$(close) Disabled`, description: 'Free-form commit messages', value: false },
      ],
      { title: 'Conventional Commits', placeHolder: enabled ? 'Currently enabled' : 'Currently disabled' },
    );
    if (!picked) {
      return;
    }
    await this.updateSetting('conventional.enabled', picked.value);
    void vscode.window.showInformationMessage(
      brand(`Conventional Commits ${picked.value ? 'enabled' : 'disabled'}.`),
    );
  }

  private async editLocalOnly(): Promise<void> {
    const current = this.deps.config.read().privacy.localOnly;
    const picked = await vscode.window.showQuickPick(
      [
        {
          label: '$(check) Enabled',
          description: 'Only loopback endpoints: Ollama, LM Studio, llama.cpp, vLLM',
          value: true,
        },
        {
          label: '$(close) Disabled',
          description: 'Allow any HTTPS provider endpoint',
          value: false,
        },
      ],
      { title: 'Local-only mode', placeHolder: current ? 'Currently enabled' : 'Currently disabled' },
    );
    if (!picked) {
      return;
    }
    await this.updateSetting('privacy.localOnly', picked.value);
    void vscode.window.showInformationMessage(
      brand(`local-only mode ${picked.value ? 'enabled' : 'disabled'}.`),
    );
  }

  private async offerAddProvider(): Promise<void> {
    const choice = await vscode.window.showInformationMessage(
      brand('no provider is configured yet.'),
      'Add Provider',
    );
    if (choice === 'Add Provider') {
      await this.addProvider();
    }
  }

  private describeActive(): string {
    const active = vscode.workspace.getConfiguration(PRODUCT.configSection).get<string>('activeProfileId', '');
    return active.length > 0 ? active : 'automatic';
  }

  private async openSettingsJson(): Promise<void> {
    await vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${PRODUCT.configSection}`);
  }

  private async updateSetting(key: string, value: unknown): Promise<void> {
    await vscode.workspace
      .getConfiguration(PRODUCT.configSection)
      .update(key, value, vscode.ConfigurationTarget.Global);
  }

  private async showError(message: string): Promise<void> {
    const choice = await vscode.window.showErrorMessage(message, 'Open Settings');
    if (choice === 'Open Settings') {
      await this.openSettingsJson();
    }
  }

  private async askString(
    title: string,
    value: string,
    validate?: (input: string) => string | undefined,
  ): Promise<string | undefined> {
    return vscode.window.showInputBox({
      title,
      value,
      ignoreFocusOut: true,
      validateInput: validate,
    });
  }

  private async askNumber(
    title: string,
    value: number,
    min: number,
    max: number,
  ): Promise<number | undefined> {
    const text = await this.askString(title, String(value), (input) => {
      const parsed = Number(input);
      if (!Number.isInteger(parsed)) {
        return 'Enter a whole number.';
      }
      if (parsed < min || parsed > max) {
        return `Enter a value between ${min} and ${max}.`;
      }
      return undefined;
    });
    return text === undefined ? undefined : Number(text);
  }

  private async askFloat(
    title: string,
    value: number,
    min: number,
    max: number,
  ): Promise<number | undefined> {
    const text = await this.askString(title, String(value), (input) => {
      const parsed = Number(input);
      if (!Number.isFinite(parsed)) {
        return 'Enter a number.';
      }
      if (parsed < min || parsed > max) {
        return `Enter a value between ${min} and ${max}.`;
      }
      return undefined;
    });
    return text === undefined ? undefined : Number(text);
  }
}

