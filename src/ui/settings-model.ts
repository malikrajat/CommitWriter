import type { ProviderProfile } from '../core/domain/provider-profile.js';
import { PRODUCT } from '../core/product.js';
import type { ResolvedConfig } from '../core/ports/i-config.js';

export type ToggleKey =
  | 'context.includeStaged'
  | 'context.includeUnstaged'
  | 'context.includeUntracked'
  | 'conventional.enabled'
  | 'privacy.localOnly';

const TOGGLE_KEYS: readonly ToggleKey[] = [
  'context.includeStaged',
  'context.includeUnstaged',
  'context.includeUntracked',
  'conventional.enabled',
  'privacy.localOnly',
];

export function isToggleKey(value: unknown): value is ToggleKey {
  return typeof value === 'string' && (TOGGLE_KEYS as readonly string[]).includes(value);
}

export interface SettingsItem {
  readonly id: string;
  readonly kind: 'toggle' | 'action' | 'info';
  readonly label: string;
  readonly description: string;
  readonly value?: string;
  readonly checked?: boolean;
  readonly settingKey?: ToggleKey;
  readonly command?: string;
  readonly args?: readonly unknown[];
  readonly icon?: string;
}

export interface SettingsSection {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly items: readonly SettingsItem[];
}

export interface SettingsViewModel {
  readonly title: string;
  readonly subtitle: string;
  readonly searchPlaceholder: string;
  readonly sections: readonly SettingsSection[];
  readonly footer: string;
}

function toggle(
  id: string,
  label: string,
  description: string,
  checked: boolean,
  settingKey: ToggleKey,
  icon: string,
): SettingsItem {
  return { id, kind: 'toggle', label, description, checked, settingKey, icon };
}

export function buildSettingsModel(
  config: ResolvedConfig,
  profiles: readonly ProviderProfile[],
  activeProfileId: string,
): SettingsViewModel {
  const active = profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0];
  const activeValue = active ? `${active.label} - ${active.model}` : 'No provider configured';

  return {
    title: PRODUCT.displayName,
    subtitle: 'AI commit messages from your changes. Nothing is committed automatically.',
    searchPlaceholder: 'Search settings and actions',
    footer: 'Keys stay in the OS keychain. No telemetry. No automatic commits.',
    sections: [
      {
        id: 'provider',
        title: 'Provider',
        description: 'Choose which AI service writes your messages.',
        items: [
          { id: 'active-provider', kind: 'info', label: 'Active provider', description: 'The profile used for the next generation.', value: activeValue, icon: 'account' },
          { id: 'switch-provider', kind: 'action', label: 'Switch provider', description: 'Pick another saved profile without changing other settings.', command: PRODUCT.command.selectProfile, icon: 'arrow-swap' },
          { id: 'add-provider', kind: 'action', label: 'Add provider', description: 'Create a profile for a cloud or local model.', command: PRODUCT.command.addProfile, icon: 'add' },
          { id: 'test-provider', kind: 'action', label: 'Test connection', description: 'Check the URL, key and model with a small request.', command: PRODUCT.command.testConnection, icon: 'plug' },
          { id: 'set-key', kind: 'action', label: 'Set API key', description: 'Stored in the OS keychain, never in settings.json.', command: PRODUCT.command.setApiKey, icon: 'key' },
        ],
      },
      {
        id: 'changes',
        title: 'What to include',
        description: 'Only selected changes are read and sent.',
        items: [
          toggle('staged', 'Staged changes', 'Files added to the Git index. This is the default.', config.context.includeStaged, 'context.includeStaged', 'diff'),
          toggle('unstaged', 'Unstaged changes', 'Edits in the working tree that are not staged yet.', config.context.includeUnstaged, 'context.includeUnstaged', 'edit'),
          toggle('untracked', 'Untracked files', 'New files that Git is not tracking yet.', config.context.includeUntracked, 'context.includeUntracked', 'new-file'),
        ],
      },
      {
        id: 'message',
        title: 'Message',
        description: 'Control depth, limits and formatting.',
        items: [
          { id: 'mode', kind: 'action', label: 'Generation mode', description: 'Quick is one request, Smart adapts, Detailed analyses deeper.', value: config.mode, command: PRODUCT.command.setMode, icon: 'symbol-color' },
          toggle('conventional', 'Conventional Commits', 'Validate type, scope and subject length.', config.conventional.enabled, 'conventional.enabled', 'checklist'),
          { id: 'budget', kind: 'action', label: 'Token budget', description: 'Maximum diff content sent to the model.', value: `${config.context.maxDiffTokens} tokens`, command: PRODUCT.command.setTokenBudget, icon: 'symbol-numeric' },
          { id: 'timeout', kind: 'action', label: 'Request timeout', description: 'Upper bound for a single provider request.', value: `${config.provider.timeoutMs} ms`, command: PRODUCT.command.setRequestTimeout, icon: 'clock' },
          { id: 'max-files', kind: 'action', label: 'Maximum files', description: 'Limit how many files are analysed per run.', value: String(config.context.maxFiles), command: 'workbench.action.openSettings', args: [`@ext:${PRODUCT.id} maxFiles`], icon: 'files' },
        ],
      },
      {
        id: 'privacy',
        title: 'Privacy',
        description: 'Control what may leave this machine.',
        items: [
          toggle('local-only', 'Local-only mode', 'Reject every non-loopback endpoint. Use for offline or confidential work.', config.privacy.localOnly, 'privacy.localOnly', 'shield'),
          { id: 'sensitive-once', kind: 'action', label: 'Allow sensitive files once', description: 'Include sensitive paths for the next run only, with a warning.', command: PRODUCT.command.allowSensitiveFilesOnce, icon: 'unlock' },
          { id: 'revoke-consent', kind: 'action', label: 'Revoke network consent', description: 'Ask again before sending data to any provider.', command: PRODUCT.command.revokeEgressConsent, icon: 'circle-slash' },
        ],
      },
      {
        id: 'help',
        title: 'Help',
        description: 'Inspect, troubleshoot and learn.',
        items: [
          { id: 'generate', kind: 'action', label: 'Generate commit message', description: 'Write a message into the Source Control input box.', command: PRODUCT.command.generate, icon: 'sparkle' },
          { id: 'preview', kind: 'action', label: 'Preview payload', description: 'See the exact redacted text that would be sent.', command: PRODUCT.command.previewPayload, icon: 'eye' },
          { id: 'diagnostics', kind: 'action', label: 'Show diagnostics', description: 'Environment, Git and provider summary.', command: PRODUCT.command.showDiagnostics, icon: 'info' },
          { id: 'log', kind: 'action', label: 'Show log', description: 'Counts and errors only, never prompts or diffs.', command: PRODUCT.command.showOutput, icon: 'output' },
          { id: 'all-settings', kind: 'action', label: 'All settings', description: 'Open the full settings editor.', command: 'workbench.action.openSettings', args: [`@ext:${PRODUCT.id}`], icon: 'settings-gear' },
        ],
      },
    ],
  };
}

function matches(item: SettingsItem, query: string): boolean {
  const haystack = `${item.label} ${item.description} ${item.value ?? ''} ${item.command ?? ''}`.toLowerCase();
  return haystack.includes(query);
}

export function filterSettingsModel(model: SettingsViewModel, rawQuery: string): SettingsViewModel {
  const query = rawQuery.trim().toLowerCase();
  if (query.length === 0) {
    return model;
  }
  const sections = model.sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => matches(item, query)),
    }))
    .filter((section) => section.items.length > 0);
  return { ...model, sections };
}
