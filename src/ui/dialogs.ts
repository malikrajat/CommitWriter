import * as vscode from 'vscode';
import { PRODUCT } from '../core/product.js';
import type { ConsentRequest } from '../core/domain/consent.js';
import type { ProviderProfile } from '../core/domain/provider-profile.js';
import type { RepositoryChoice } from '../git/repository-resolver.js';

export type DraftDecision = 'replace' | 'append' | 'cancel';

export async function askDraftPolicy(current: string): Promise<DraftDecision> {
  const preview = current.length > 120 ? `${current.slice(0, 120)}...` : current;
  const choice = await vscode.window.showWarningMessage(
    `The commit message box already contains text:\n\n${preview}`,
    { modal: true },
    'Replace',
    'Append',
    'Cancel',
  );
  if (choice === 'Replace') {
    return 'replace';
  }
  if (choice === 'Append') {
    return 'append';
  }
  return 'cancel';
}

export async function pickRepository(choices: readonly RepositoryChoice[]): Promise<RepositoryChoice | undefined> {
  const items = choices.map((choice) => ({
    label: choice.label,
    description: choice.description,
    detail: choice.selected ? 'Currently selected in Source Control' : undefined,
    choice,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    title: 'Select a repository',
    placeHolder: `${PRODUCT.displayName} generates one message for one repository`,
  });
  return picked?.choice;
}

export async function pickProfile(
  profiles: readonly ProviderProfile[],
  title = 'Select a provider profile',
): Promise<ProviderProfile | undefined> {
  const items = profiles.map((profile) => ({
    label: profile.label,
    description: `${profile.provider} | ${profile.model}`,
    detail: profile.baseUrl,
    profile,
  }));
  const picked = await vscode.window.showQuickPick(items, { title });
  return picked?.profile;
}

export async function promptSecret(
  profile: ProviderProfile,
  kind: 'apiKey' | 'basicPassword' = 'apiKey',
): Promise<string | undefined> {
  return vscode.window.showInputBox({
    title: kind === 'basicPassword' ? `Server password for ${profile.label}` : `API key for ${profile.label}`,
    prompt:
      kind === 'basicPassword'
        ? 'Matches OPENCODE_SERVER_PASSWORD. Stored in the OS keychain, never in settings or logs.'
        : 'Stored in the OS keychain. It is never written to settings or logs.',
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim().length === 0 ? 'The value must not be empty.' : undefined),
  });
}

export async function confirm(message: string, action: string): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(message, { modal: true }, action);
  return choice === action;
}

export interface ConsentDecision {
  readonly granted: boolean;
  readonly preview: boolean;
}

export async function askConsent(request: ConsentRequest): Promise<ConsentDecision> {
  const route = request.routedVia
    ? `\nOpenCode will forward this request to ${request.routedVia.providerId} / ${request.routedVia.modelId} using its own credentials.`
    : '';
  const message =
    `${PRODUCT.displayName} will send a redacted diff of your changes to:\n\n` +
    `${request.origin} (${request.providerId}, ${request.model})\n` +
    `Mode: ${request.mode} | ~${request.estimatedTokens} tokens${route}\n\n` +
    `Sensitive files and credential-shaped content are removed before sending.`;

  const choice = await vscode.window.showInformationMessage(
    message,
    { modal: true },
    'Send',
    'Preview payload',
    'Cancel',
  );
  if (choice === 'Send') {
    return { granted: true, preview: false };
  }
  if (choice === 'Preview payload') {
    return { granted: false, preview: true };
  }
  return { granted: false, preview: false };
}

export async function showPreview(content: string): Promise<void> {
  const document = await vscode.workspace.openTextDocument({ content, language: 'markdown' });
  await vscode.window.showTextDocument(document, { preview: true });
}
