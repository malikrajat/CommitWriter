import {
  isForbiddenHeader,
  type ProfileAuthStyle,
  type ProviderId,
  type ProviderProfile,
  type WireDialect,
} from '../core/domain/provider-profile.js';
import { evaluateUrl } from '../core/security/url-policy.js';
import { presetFor } from '../providers/presets.js';

export interface ProfileDraft {
  readonly id: string;
  readonly label: string;
  readonly provider: ProviderId;
  readonly dialect: WireDialect;
  readonly baseUrl: string;
  readonly model: string;
  readonly contextWindow: number;
  readonly temperature: number;
  readonly maxOutputTokens: number;
  readonly timeoutMs?: number;
  readonly authStyle?: ProfileAuthStyle;
  readonly authHeaderName?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export const CUSTOM_DIALECTS: readonly WireDialect[] = [
  'openai-chat',
  'anthropic-messages',
  'gemini-generate',
  'ollama-native',
];

export function suggestProfileId(provider: ProviderId, existing: readonly string[]): string {
  const base = provider;
  if (!existing.includes(base)) {
    return base;
  }
  let suffix = 2;
  while (existing.includes(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

export function defaultDraft(provider: ProviderId, existing: readonly string[]): ProfileDraft {
  const preset = presetFor(provider);
  return {
    id: suggestProfileId(provider, existing),
    label: preset.label,
    provider,
    dialect: preset.dialect,
    baseUrl: preset.baseUrl,
    model: preset.modelHint,
    contextWindow: preset.defaultContextWindow,
    temperature: 0.2,
    maxOutputTokens: 512,
    authStyle: provider === 'custom' ? 'bearer' : undefined,
  };
}

export type HeaderParseResult =
  | { readonly ok: true; readonly headers: Readonly<Record<string, string>> }
  | { readonly ok: false; readonly message: string };

export function parseHeadersJson(text: string): HeaderParseResult {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { ok: true, headers: {} };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, message: 'Headers must be valid JSON, for example {"X-Org": "team"}.' };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, message: 'Headers must be a JSON object.' };
  }

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'string') {
      return { ok: false, message: `Header "${key}" must have a string value.` };
    }
    if (isForbiddenHeader(key)) {
      return { ok: false, message: `Header "${key}" is reserved for credentials; use the API key command.` };
    }
    headers[key] = value;
  }
  return { ok: true, headers };
}

export function draftToProfile(draft: ProfileDraft): ProviderProfile {
  const preset = presetFor(draft.provider);
  return {
    id: draft.id.trim(),
    label: draft.label.trim().length > 0 ? draft.label.trim() : preset.label,
    provider: draft.provider,
    dialect: draft.provider === 'custom' ? draft.dialect : preset.dialect,
    baseUrl: draft.baseUrl.trim().length > 0 ? draft.baseUrl.trim() : preset.baseUrl,
    model: draft.model.trim(),
    contextWindow: draft.contextWindow,
    temperature: draft.temperature,
    maxOutputTokens: draft.maxOutputTokens,
    timeoutMs: draft.timeoutMs,
    headers: draft.headers && Object.keys(draft.headers).length > 0 ? draft.headers : undefined,
    authStyle: draft.authStyle,
    authHeaderName: draft.authHeaderName,
  };
}

export interface DraftValidation {
  readonly valid: boolean;
  readonly problems: readonly string[];
}

export function validateDraft(
  draft: ProfileDraft,
  options: { readonly localOnly?: boolean } = {},
): DraftValidation {
  const problems: string[] = [];
  const profile = draftToProfile(draft);

  if (draft.id.trim().length === 0) {
    problems.push('Profile id is required.');
  }
  if (profile.model.length === 0) {
    problems.push('Model id is required.');
  }
  if (profile.baseUrl.length === 0) {
    problems.push('Base URL is required.');
  } else {
    const url = evaluateUrl(profile.baseUrl, profile.provider, { localOnly: options.localOnly });
    if (!url.ok) {
      problems.push(url.error.message);
    }
  }
  if (!Number.isFinite(profile.temperature) || profile.temperature < 0 || profile.temperature > 2) {
    problems.push('Temperature must be between 0 and 2.');
  }
  if (
    !Number.isInteger(profile.maxOutputTokens) ||
    profile.maxOutputTokens < 32 ||
    profile.maxOutputTokens > 16384
  ) {
    problems.push('Max output tokens must be an integer between 32 and 16384.');
  }
  if (!Number.isInteger(profile.contextWindow) || profile.contextWindow < 1024) {
    problems.push('Context window must be an integer of at least 1024.');
  }
  if (
    profile.timeoutMs !== undefined &&
    (!Number.isInteger(profile.timeoutMs) || profile.timeoutMs < 5000 || profile.timeoutMs > 300000)
  ) {
    problems.push('Request timeout must be an integer between 5000 and 300000 ms.');
  }

  return { valid: problems.length === 0, problems };
}
